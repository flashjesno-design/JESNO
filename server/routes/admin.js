'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const config = require('../config');
const Formula = require('../../shared/formula');
const { requireRole, requireTenantUser } = require('../auth');
const { requireFeature, hasFeature, readKey, getLicense, countUsers, PLANS, ALL_FEATURES } = require('../lib/license');
const { loadModel } = require('../lib/model');
const { jparse, toNum, audit, httpError, tempPassword, slugify, nowSql, ROLES, wrapAsync } = require('../lib/util');
const { queueEmail, notify, EVENT_LABELS, DEFAULT_TEMPLATES, flush } = require('../lib/notify');
const { COND_FIELDS } = require('../lib/workflow');
const { DEFAULT_SETTINGS } = require('../lib/defaults');

const router = express.Router();
router.use(requireTenantUser);

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const adminOnly = requireRole('admin');
const TID = (req) => req.user.tenant_id;

// ───────────────────────────── Utilisateurs
const userOut = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, department: u.department, active: !!u.active, notif_email: !!u.notif_email, notif_whatsapp: !!u.notif_whatsapp, notif_inapp: !!u.notif_inapp, delegate_id: u.delegate_id, delegate_until: u.delegate_until, last_login: u.last_login, created_at: u.created_at, must_change: !!u.must_change });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/admin/users', adminOnly, (req, res) => {
  res.json({ users: db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY active DESC, name').all(TID(req)).map(userOut), roles: ROLES, max_users: req.license.max_users, used: countUsers(TID(req)) });
});

function checkRole(role) { if (!ROLES[role]) throw httpError(422, 'Rôle invalide.'); }

router.post('/admin/users', adminOnly, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  if (!name) throw httpError(422, 'Le nom est obligatoire.');
  if (!EMAIL_RE.test(email)) throw httpError(422, 'Adresse e-mail invalide.');
  checkRole(b.role);
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email)) throw httpError(409, 'Cette adresse e-mail est déjà utilisée.');
  if (req.license.max_users && countUsers(TID(req)) >= req.license.max_users) throw httpError(402, `Nombre maximal d'utilisateurs atteint (${req.license.max_users}) : passez à une licence supérieure.`);
  const pwd = tempPassword();
  const info = db.prepare('INSERT INTO users (tenant_id,email,name,phone,role,password_hash,department,must_change,notif_whatsapp) VALUES (?,?,?,?,?,?,?,1,?)')
    .run(TID(req), email, name, String(b.phone || '').trim() || null, b.role, bcrypt.hashSync(pwd, 10), b.department || null, b.phone ? 1 : 0);
  if (b.send_invite !== false) {
    queueEmail({ tenantId: TID(req), userId: info.lastInsertRowid, to: email, event: 'invite', subject: `Votre accès ${config.APP_NAME}`,
      body: `Bonjour ${name.split(' ')[0]},\n\n${req.user.name} vous a créé un accès à ${config.APP_NAME} (${req.tenant.name}) avec le rôle « ${ROLES[b.role]} ».\n\nIdentifiant : ${email}\nMot de passe temporaire : ${pwd}\n\nVous devrez le changer à la première connexion.`, link: config.BASE_URL });
  }
  audit(req, 'user_create', 'user', info.lastInsertRowid, `${email} (${b.role})`);
  res.status(201).json({ id: info.lastInsertRowid, temp_password: pwd });
});

router.put('/admin/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(id, TID(req));
  if (!u) throw httpError(404, 'Utilisateur introuvable.');
  const b = req.body || {};
  const role = b.role !== undefined ? b.role : u.role; checkRole(role);
  const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
  const adminsLeft = db.prepare("SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1 AND id != ?").get(TID(req), id).c;
  if ((role !== 'admin' || !active) && u.role === 'admin' && adminsLeft === 0) throw httpError(409, 'Il doit rester au moins un administrateur actif.');
  if (id === req.user.id && !active) throw httpError(409, 'Vous ne pouvez pas désactiver votre propre compte.');
  if (active && !u.active && req.license.max_users && countUsers(TID(req)) >= req.license.max_users) throw httpError(402, 'Nombre maximal d\'utilisateurs atteint.');
  let email = u.email;
  if (b.email !== undefined && String(b.email).trim().toLowerCase() !== String(u.email).toLowerCase()) {
    email = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw httpError(422, 'Adresse e-mail invalide.');
    if (email !== u.email && db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND id != ?').get(email, id)) throw httpError(409, 'Adresse e-mail déjà utilisée.');
  }
  db.prepare('UPDATE users SET name=?, email=?, phone=?, role=?, department=?, active=?, delegate_id=?, delegate_until=?, notif_email=?, notif_whatsapp=?, notif_inapp=?, token_version = token_version + ? WHERE id=?')
    .run(String(b.name !== undefined ? b.name : u.name).trim() || u.name, email, b.phone !== undefined ? (String(b.phone).trim() || null) : u.phone, role, b.department !== undefined ? (b.department || null) : u.department, active,
      b.delegate_id !== undefined ? (b.delegate_id || null) : u.delegate_id, b.delegate_until !== undefined ? (b.delegate_until || null) : u.delegate_until,
      b.notif_email !== undefined ? +!!b.notif_email : u.notif_email, b.notif_whatsapp !== undefined ? +!!b.notif_whatsapp : u.notif_whatsapp, b.notif_inapp !== undefined ? +!!b.notif_inapp : u.notif_inapp,
      (!active && u.active) || role !== u.role ? 1 : 0, id);
  audit(req, 'user_update', 'user', id, JSON.stringify({ role, active }));
  res.json({ ok: true });
});

router.post('/admin/users/:id/reset-password', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(id, TID(req));
  if (!u) throw httpError(404, 'Utilisateur introuvable.');
  const pwd = tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1, token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(pwd, 10), id);
  queueEmail({ tenantId: TID(req), userId: id, to: u.email, event: 'invite', subject: `${config.APP_NAME} : nouveau mot de passe temporaire`, body: `Bonjour ${u.name.split(' ')[0]},\n\nVotre mot de passe a été réinitialisé par un administrateur.\nMot de passe temporaire : ${pwd}\n\nVous devrez le changer à la prochaine connexion.`, link: config.BASE_URL });
  audit(req, 'user_reset_password', 'user', id, '');
  res.json({ temp_password: pwd });
});

// Profil personnel (tout utilisateur)
router.put('/me', (req, res) => {
  const b = req.body || {}; const u = req.user;
  db.prepare('UPDATE users SET name=?, phone=?, notif_email=?, notif_whatsapp=?, notif_inapp=?, delegate_id=?, delegate_until=? WHERE id=?')
    .run(String(b.name || u.name).trim() || u.name, b.phone !== undefined ? (String(b.phone).trim() || null) : u.phone,
      b.notif_email !== undefined ? +!!b.notif_email : u.notif_email, b.notif_whatsapp !== undefined ? +!!b.notif_whatsapp : u.notif_whatsapp, b.notif_inapp !== undefined ? +!!b.notif_inapp : u.notif_inapp,
      b.delegate_id !== undefined ? (b.delegate_id && b.delegate_id !== u.id ? Number(b.delegate_id) : null) : u.delegate_id, b.delegate_until !== undefined ? (b.delegate_until || null) : u.delegate_until, u.id);
  res.json({ ok: true });
});

// ───────────────────────────── Champs & sections
const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'percent', 'date', 'select', 'checkbox', 'calc', 'pscs', 'supplier'];
const OPS = ['eq', 'ne', 'empty', 'notempty', 'gt', 'lt'];
const CORE_ROLES = ['o_supplier', 'o_conformity', 'o_amount', 'amount_final', 'currency', 'budget', 'title'];

function fieldOut(f) { return { ...f, options: jparse(f.options, null), visible_if: jparse(f.visible_if, null) }; }

router.get('/admin/fields', adminOnly, (req, res) => {
  const fields = db.prepare('SELECT * FROM fields WHERE tenant_id = ? ORDER BY scope, sort, id').all(TID(req)).map(fieldOut);
  const sections = db.prepare('SELECT * FROM sections WHERE tenant_id = ? ORDER BY scope, sort, id').all(TID(req));
  const lists = db.prepare('SELECT * FROM ref_lists WHERE tenant_id = ? ORDER BY label').all(TID(req));
  res.json({ fields, sections, lists, types: FIELD_TYPES, custom_allowed: hasFeature(req.license, 'custom_fields') });
});

function normField(b, existing) {
  const type = existing ? existing.type : b.type;
  if (!FIELD_TYPES.includes(type)) throw httpError(422, 'Type de champ invalide.');
  const label = String(b.label !== undefined ? b.label : (existing && existing.label) || '').trim();
  if (!label) throw httpError(422, 'Le libellé est obligatoire.');
  let formula = b.formula !== undefined ? String(b.formula || '').trim() : (existing && existing.formula) || null;
  if (type === 'calc') {
    if (!formula) throw httpError(422, 'Une formule est obligatoire pour un champ calculé.');
    const chk = Formula.check(formula);
    if (chk && chk.ok === false) throw httpError(422, `Formule invalide : ${chk.error}`);
  } else formula = null;
  const width = [1, 2, 4].includes(Number(b.width)) ? Number(b.width) : (existing ? existing.width : 2);
  let visible = b.visible_if !== undefined ? b.visible_if : (existing ? jparse(existing.visible_if, null) : null);
  if (visible && visible.field) {
    if (!OPS.includes(visible.op)) throw httpError(422, 'Opérateur de condition invalide.');
    visible = { field: String(visible.field), op: visible.op, value: visible.value === undefined ? '' : visible.value };
  } else visible = null;
  let options = b.options !== undefined ? b.options : (existing ? jparse(existing.options, null) : null);
  if (type === 'calc') options = { format: ['money', 'percent', 'number', 'text'].includes((options || {}).format) ? options.format : 'number' };
  else if (type !== 'select') options = options && typeof options === 'object' ? options : null;
  return {
    label, type, formula,
    section_key: b.section_key !== undefined ? (b.section_key || null) : (existing ? existing.section_key : null),
    required: type === 'calc' ? 0 : (b.required !== undefined ? +!!b.required : (existing ? existing.required : 0)),
    list_key: type === 'select' ? (b.list_key !== undefined ? (b.list_key || null) : (existing ? existing.list_key : null)) : null,
    default_value: b.default_value !== undefined ? (String(b.default_value) || null) : (existing ? existing.default_value : null),
    help: b.help !== undefined ? (String(b.help).slice(0, 300) || null) : (existing ? existing.help : null),
    width, visible_if: visible ? JSON.stringify(visible) : null,
    options: options ? JSON.stringify(options) : null,
    decimals: b.decimals !== undefined ? (b.decimals === '' || b.decimals === null ? null : Math.min(6, Math.max(0, Number(b.decimals)))) : (existing ? existing.decimals : null),
    active: b.active !== undefined ? +!!b.active : (existing ? existing.active : 1)
  };
}

router.post('/admin/fields', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const b = req.body || {};
  const scope = b.scope === 'offer' ? 'offer' : 'fae';
  let key = slugify(b.key || b.label).replace(/-/g, '_');
  if (!/^[a-z]/.test(key)) key = 'c_' + key;
  key = key.slice(0, 32);
  if (db.prepare('SELECT 1 FROM fields WHERE tenant_id = ? AND scope = ? AND key = ?').get(TID(req), scope, key)) {
    let i = 2; while (db.prepare('SELECT 1 FROM fields WHERE tenant_id = ? AND scope = ? AND key = ?').get(TID(req), scope, `${key}_${i}`)) i++; key = `${key}_${i}`;
  }
  const n = normField(b, null);
  const section = n.section_key || (db.prepare('SELECT key FROM sections WHERE tenant_id = ? AND scope = ? ORDER BY sort LIMIT 1').get(TID(req), scope) || {}).key || null;
  const sort = (db.prepare('SELECT COALESCE(MAX(sort),0) m FROM fields WHERE tenant_id = ? AND scope = ?').get(TID(req), scope).m) + 10;
  const info = db.prepare(`INSERT INTO fields (tenant_id,scope,key,label,type,section_key,sort,required,list_key,options,formula,default_value,help,width,visible_if,decimals,active,locked)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .run(TID(req), scope, key, n.label, n.type, section, sort, n.required, n.list_key, n.options, n.formula, n.default_value, n.help, n.width, n.visible_if, n.decimals, n.active);
  audit(req, 'field_create', 'field', info.lastInsertRowid, `${scope}.${key}`);
  res.status(201).json({ id: info.lastInsertRowid, key });
});

router.put('/admin/fields/:id', adminOnly, (req, res) => {
  const f = db.prepare('SELECT * FROM fields WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!f) throw httpError(404, 'Champ introuvable.');
  const hasCustom = hasFeature(req.license, 'custom_fields');
  const b = req.body || {};
  // Sans l'option « champs personnalisés » : seuls libellé, aide et obligatoire des champs de base sont modifiables.
  const payload = hasCustom ? b : { label: b.label, help: b.help, required: b.required };
  if (f.role && CORE_ROLES.includes(f.role) && payload.active === false) throw httpError(409, 'Ce champ est indispensable au calcul des indicateurs : il ne peut pas être masqué.');
  const n = normField(payload, f);
  db.prepare('UPDATE fields SET label=?, section_key=?, required=?, list_key=?, options=?, formula=?, default_value=?, help=?, width=?, visible_if=?, decimals=?, active=? WHERE id=?')
    .run(n.label, n.section_key, n.required, n.list_key, n.options, n.formula, n.default_value, n.help, n.width, n.visible_if, n.decimals, n.active, f.id);
  audit(req, 'field_update', 'field', f.id, `${f.scope}.${f.key}`);
  res.json({ ok: true });
});

router.delete('/admin/fields/:id', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const f = db.prepare('SELECT * FROM fields WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!f) throw httpError(404, 'Champ introuvable.');
  if (f.locked) throw httpError(409, 'Les champs de base ne peuvent pas être supprimés (vous pouvez les masquer).');
  const used = db.prepare("SELECT COUNT(*) c FROM fields WHERE tenant_id = ? AND (formula LIKE ? OR visible_if LIKE ?)").get(TID(req), `%{${f.key}}%`, `%"${f.key}"%`).c;
  if (used) throw httpError(409, 'Ce champ est utilisé par une formule ou une condition d\'affichage : modifiez-les d\'abord.');
  db.prepare('DELETE FROM fields WHERE id = ?').run(f.id);
  audit(req, 'field_delete', 'field', f.id, `${f.scope}.${f.key}`);
  res.json({ ok: true });
});

router.post('/admin/fields/reorder', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const { scope, items } = req.body || {}; // items: [{key, section_key}] dans l'ordre voulu
  if (!Array.isArray(items)) throw httpError(422, 'Ordre invalide.');
  const up = db.prepare('UPDATE fields SET sort = ?, section_key = COALESCE(?, section_key) WHERE tenant_id = ? AND scope = ? AND key = ?');
  db.transaction(() => items.forEach((it, i) => up.run((i + 1) * 10, it.section_key || null, TID(req), scope === 'offer' ? 'offer' : 'fae', it.key)))();
  res.json({ ok: true });
});

router.post('/admin/fields/check-formula', adminOnly, (req, res) => {
  const chk = Formula.check(String((req.body || {}).formula || ''));
  res.json({ ok: !(chk && chk.ok === false), error: chk && chk.error });
});

router.post('/admin/sections', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const b = req.body || {};
  const label = String(b.label || '').trim(); if (!label) throw httpError(422, 'Le titre de la section est obligatoire.');
  const scope = 'fae';
  let key = slugify(label).replace(/-/g, '_'); let i = 1; const base = key;
  while (db.prepare('SELECT 1 FROM sections WHERE tenant_id = ? AND scope = ? AND key = ?').get(TID(req), scope, key)) key = `${base}_${++i}`;
  const sort = (db.prepare('SELECT COALESCE(MAX(sort),0) m FROM sections WHERE tenant_id = ? AND scope = ?').get(TID(req), scope).m) + 1;
  db.prepare('INSERT INTO sections (tenant_id,scope,key,label,color,sort) VALUES (?,?,?,?,?,?)').run(TID(req), scope, key, label, /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#2f5d8a', sort);
  res.status(201).json({ key });
});
router.put('/admin/sections/:id', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!s) throw httpError(404, 'Section introuvable.');
  const b = req.body || {};
  db.prepare('UPDATE sections SET label=?, color=?, active=?, sort=? WHERE id=?').run(String(b.label || s.label).trim() || s.label, /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : s.color, b.active !== undefined ? +!!b.active : s.active, b.sort !== undefined ? Number(b.sort) : s.sort, s.id);
  res.json({ ok: true });
});
router.delete('/admin/sections/:id', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!s) throw httpError(404, 'Section introuvable.');
  if (db.prepare('SELECT 1 FROM fields WHERE tenant_id = ? AND scope = ? AND section_key = ?').get(TID(req), s.scope, s.key)) throw httpError(409, 'Cette section contient encore des champs : déplacez-les d\'abord.');
  db.prepare('DELETE FROM sections WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

// ───────────────────────────── Listes déroulantes
router.get('/admin/lists', adminOnly, (req, res) => {
  const lists = db.prepare('SELECT * FROM ref_lists WHERE tenant_id = ? ORDER BY label').all(TID(req));
  const items = db.prepare('SELECT * FROM ref_items WHERE tenant_id = ? ORDER BY list_key, sort, id').all(TID(req));
  res.json({ lists: lists.map((l) => ({ ...l, items: items.filter((i) => i.list_key === l.key).map((i) => ({ id: i.id, value: i.value, label: i.label, meta: jparse(i.meta, {}), active: !!i.active })) })) });
});
router.post('/admin/lists', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const label = String((req.body || {}).label || '').trim(); if (!label) throw httpError(422, 'Nom de liste obligatoire.');
  let key = slugify(label).replace(/-/g, '_'); const base = key; let i = 1;
  while (db.prepare('SELECT 1 FROM ref_lists WHERE tenant_id = ? AND key = ?').get(TID(req), key)) key = `${base}_${++i}`;
  db.prepare('INSERT INTO ref_lists (tenant_id,key,label,system) VALUES (?,?,?,0)').run(TID(req), key, label);
  res.status(201).json({ key });
});
router.put('/admin/lists/:key', adminOnly, (req, res) => {
  const l = db.prepare('SELECT * FROM ref_lists WHERE tenant_id = ? AND key = ?').get(TID(req), req.params.key);
  if (!l) throw httpError(404, 'Liste introuvable.');
  const items = (req.body || {}).items;
  if (!Array.isArray(items)) throw httpError(422, 'Éléments invalides.');
  const seen = new Set();
  const clean = items.map((it) => ({ value: String(it.value || '').trim(), label: String(it.label || it.value || '').trim(), meta: it.meta && typeof it.meta === 'object' ? it.meta : {}, active: it.active === false ? 0 : 1 }))
    .filter((it) => { if (!it.value || seen.has(it.value.toLowerCase())) return false; seen.add(it.value.toLowerCase()); return true; });
  if (l.key === 'currency' && !clean.some((c) => c.value.toUpperCase() === 'CFA')) throw httpError(422, 'La devise CFA est indispensable.');
  db.transaction(() => {
    if ((req.body || {}).label) db.prepare('UPDATE ref_lists SET label = ? WHERE tenant_id = ? AND key = ?').run(String(req.body.label).trim(), TID(req), l.key);
    db.prepare('DELETE FROM ref_items WHERE tenant_id = ? AND list_key = ?').run(TID(req), l.key);
    const ins = db.prepare('INSERT INTO ref_items (tenant_id,list_key,value,label,meta,sort,active) VALUES (?,?,?,?,?,?,?)');
    clean.forEach((it, i) => ins.run(TID(req), l.key, it.value, it.label, JSON.stringify(it.meta), i, it.active));
  })();
  audit(req, 'list_update', 'list', l.key, `${clean.length} éléments`);
  res.json({ ok: true, count: clean.length });
});
router.delete('/admin/lists/:key', adminOnly, requireFeature('custom_fields'), (req, res) => {
  const l = db.prepare('SELECT * FROM ref_lists WHERE tenant_id = ? AND key = ?').get(TID(req), req.params.key);
  if (!l) throw httpError(404, 'Liste introuvable.');
  if (l.system) throw httpError(409, 'Les listes de base ne peuvent pas être supprimées.');
  if (db.prepare('SELECT 1 FROM fields WHERE tenant_id = ? AND list_key = ?').get(TID(req), l.key)) throw httpError(409, 'Cette liste est utilisée par un champ.');
  db.prepare('DELETE FROM ref_items WHERE tenant_id = ? AND list_key = ?').run(TID(req), l.key);
  db.prepare('DELETE FROM ref_lists WHERE tenant_id = ? AND key = ?').run(TID(req), l.key);
  res.json({ ok: true });
});

// ───────────────────────────── Workflow
router.get('/admin/workflow', adminOnly, (req, res) => {
  const steps = db.prepare('SELECT * FROM workflow_steps WHERE tenant_id = ? ORDER BY position, id').all(TID(req)).map((s) => ({ ...s, condition: jparse(s.condition, null) }));
  res.json({ steps, roles: ROLES, cond_fields: COND_FIELDS, builder: hasFeature(req.license, 'workflow_builder'), users: db.prepare('SELECT id, name, role FROM users WHERE tenant_id = ? AND active = 1 ORDER BY name').all(TID(req)) });
});

router.put('/admin/workflow', adminOnly, (req, res) => {
  const steps = (req.body || {}).steps;
  if (!Array.isArray(steps) || !steps.length) throw httpError(422, 'Le circuit doit contenir au moins une étape.');
  const builder = hasFeature(req.license, 'workflow_builder');
  const clean = steps.map((s, i) => {
    const type = s.approver_type === 'user' ? 'user' : 'role';
    if (type === 'role' && !ROLES[s.approver_role]) throw httpError(422, `Étape ${i + 1} : rôle validateur invalide.`);
    if (type === 'user' && !db.prepare('SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND active = 1').get(Number(s.approver_user_id), TID(req))) throw httpError(422, `Étape ${i + 1} : utilisateur validateur introuvable.`);
    let cond = s.condition && s.condition.field ? { field: String(s.condition.field), op: String(s.condition.op || 'gte'), value: s.condition.value } : null;
    if (cond && !COND_FIELDS[cond.field]) throw httpError(422, `Étape ${i + 1} : critère de condition invalide.`);
    if (!builder) cond = null;
    return {
      name: String(s.name || '').trim() || `Étape ${i + 1}`, approver_type: builder ? type : 'role', approver_role: type === 'role' ? s.approver_role : null, approver_user_id: type === 'user' ? Number(s.approver_user_id) : null,
      condition: cond, sla_hours: Math.max(0, parseInt(s.sla_hours, 10) || 0), reminder_hours: Math.max(0, parseInt(s.reminder_hours, 10) || 0),
      escalate_after_hours: Math.max(0, parseInt(s.escalate_after_hours, 10) || 0), escalate_role: s.escalate_role && ROLES[s.escalate_role] ? s.escalate_role : null, active: s.active === false || s.active === 0 ? 0 : 1
    };
  });
  if (!clean.some((s) => s.active)) throw httpError(422, 'Au moins une étape doit être active.');
  if (!builder && clean.filter((s) => s.active).length > 2) throw httpError(402, 'Votre licence permet 2 étapes de validation actives au maximum. Passez à Business pour un circuit libre.', { code: 'FEATURE_LOCKED' });
  if (!builder && clean.length !== db.prepare('SELECT COUNT(*) c FROM workflow_steps WHERE tenant_id = ?').get(TID(req)).c) throw httpError(402, 'Ajouter ou supprimer des étapes nécessite l\'option « Workflow configurable » (licence Business).', { code: 'FEATURE_LOCKED' });
  db.transaction(() => {
    db.prepare('DELETE FROM workflow_steps WHERE tenant_id = ?').run(TID(req));
    const ins = db.prepare('INSERT INTO workflow_steps (tenant_id,position,name,approver_type,approver_role,approver_user_id,condition,sla_hours,reminder_hours,escalate_after_hours,escalate_role,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    clean.forEach((s, i) => ins.run(TID(req), i + 1, s.name, s.approver_type, s.approver_role, s.approver_user_id, s.condition ? JSON.stringify(s.condition) : null, s.sla_hours, s.reminder_hours, s.escalate_after_hours, s.escalate_role, s.active));
  })();
  audit(req, 'workflow_update', 'workflow', TID(req), `${clean.length} étapes`);
  res.json({ ok: true });
});

// ───────────────────────────── Licence
router.get('/admin/license', adminOnly, (req, res) => {
  const l = req.license;
  res.json({ plan: l.plan, plan_label: (PLANS[l.plan] || {}).label, state: l.state, daysLeft: l.daysLeft, expires_at: l.expires_at, features: l.features, max_users: l.max_users, max_fae_month: l.max_fae_month, used_users: countUsers(TID(req)), plans: PLANS, all_features: ALL_FEATURES, slug: req.tenant.slug });
});
router.post('/admin/license/activate', adminOnly, (req, res) => {
  const d = readKey((req.body || {}).key);
  if (d.slug !== req.tenant.slug) throw httpError(400, 'Cette clé de licence a été émise pour un autre compte client.');
  db.prepare("UPDATE licenses SET plan=?, license_key=?, max_users=?, max_fae_month=?, features=?, expires_at=?, status='active', updated_at=? WHERE tenant_id=?")
    .run(d.plan, String((req.body || {}).key).trim(), d.max_users, d.max_fae_month, JSON.stringify(d.features), d.expires_at, nowSql(), TID(req));
  audit(req, 'license_activate', 'license', TID(req), d.plan);
  res.json({ ok: true, license: getLicense(TID(req)).plan });
});

// ───────────────────────────── Budgets annuels
router.get('/admin/budgets', adminOnly, requireFeature('budgets'), (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const model = loadModel(TID(req));
  const depts = (model.lists.department || []).map((d) => d.value);
  const rows = db.prepare('SELECT department, amount_xof FROM budgets WHERE tenant_id = ? AND year = ?').all(TID(req), year);
  const map = {}; rows.forEach((r) => { map[r.department] = r.amount_xof; });
  const used = {}; db.prepare("SELECT department, COALESCE(SUM(final_xof),0) s FROM fae WHERE tenant_id = ? AND status IN ('approved','in_review') AND strftime('%Y', created_at) = ? GROUP BY department").all(TID(req), String(year)).forEach((r) => { used[r.department] = r.s; });
  res.json({ year, items: depts.map((d) => ({ department: d, amount_xof: map[d] || 0, consumed: used[d] || 0 })) });
});
router.put('/admin/budgets', adminOnly, requireFeature('budgets'), (req, res) => {
  const { year, items } = req.body || {};
  if (!Array.isArray(items) || !Number(year)) throw httpError(422, 'Données invalides.');
  db.transaction(() => items.forEach((it) => {
    const amt = toNum(it.amount_xof) || 0;
    if (amt > 0) db.prepare('INSERT INTO budgets (tenant_id,year,department,amount_xof) VALUES (?,?,?,?) ON CONFLICT(tenant_id,year,department) DO UPDATE SET amount_xof = excluded.amount_xof').run(TID(req), Number(year), String(it.department), amt);
    else db.prepare('DELETE FROM budgets WHERE tenant_id = ? AND year = ? AND department = ?').run(TID(req), Number(year), String(it.department));
  }))();
  audit(req, 'budgets_update', 'budget', year, '');
  res.json({ ok: true });
});

// ───────────────────────────── Réglages généraux, contrôles, notifications
router.get('/admin/settings', adminOnly, (req, res) => {
  const s = jparse(req.tenant.settings, {});
  res.json({ name: req.tenant.name, brand_color: req.tenant.brand_color, settings: { ...DEFAULT_SETTINGS, ...s, controls: { ...DEFAULT_SETTINGS.controls, ...(s.controls || {}) }, notifications: { events: { ...DEFAULT_SETTINGS.notifications.events, ...((s.notifications || {}).events || {}) }, templates: (s.notifications || {}).templates || {} } },
    event_labels: EVENT_LABELS, default_templates: DEFAULT_TEMPLATES, channels: { smtp: !!config.SMTP.host, whatsapp: config.WHATSAPP.provider !== 'none' && (config.WHATSAPP.provider === 'meta' ? !!config.WHATSAPP.metaToken : !!config.WHATSAPP.twilioSid), whatsapp_provider: config.WHATSAPP.provider },
    whatsapp_allowed: hasFeature(req.license, 'whatsapp') });
});
router.put('/admin/settings', adminOnly, (req, res) => {
  const b = req.body || {};
  const cur = jparse(req.tenant.settings, {});
  const next = { ...cur };
  if (b.settings) {
    const s = b.settings;
    if (s.number_prefix !== undefined) next.number_prefix = String(s.number_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'FAE';
    if (s.max_offers !== undefined) next.max_offers = Math.min(12, Math.max(1, parseInt(s.max_offers, 10) || 6));
    if (s.buyers_see_all !== undefined) next.buyers_see_all = !!s.buyers_see_all;
    if (s.controls) {
      const c = s.controls; const mode = (v, d) => (['off', 'warn', 'block'].includes(v) ? v : d);
      next.controls = { ...(cur.controls || DEFAULT_SETTINGS.controls), min_offers: Math.max(1, parseInt(c.min_offers, 10) || 3), min_offers_mode: mode(c.min_offers_mode, 'warn'), over_budget_mode: mode(c.over_budget_mode, 'warn'), block_nonconform: c.block_nonconform !== false, require_justification_not_lowest: c.require_justification_not_lowest !== false };
    }
    if (s.notifications) {
      const ev = {}; Object.keys(EVENT_LABELS).forEach((k) => { const e = (s.notifications.events || {})[k] || {}; ev[k] = { email: !!e.email, whatsapp: !!e.whatsapp, inapp: e.inapp !== false }; });
      const tpl = {}; Object.keys(EVENT_LABELS).forEach((k) => { const t = (s.notifications.templates || {})[k]; if (t) { const o = {}; ['subject', 'body', 'wa'].forEach((f) => { if (t[f] && String(t[f]).trim() && t[f] !== DEFAULT_TEMPLATES[k][f]) o[f] = String(t[f]).slice(0, 2000); }); if (Object.keys(o).length) tpl[k] = o; } });
      next.notifications = { events: ev, templates: tpl };
    }
  }
  const name = b.name ? String(b.name).trim().slice(0, 80) : req.tenant.name;
  const color = /^#[0-9a-f]{6}$/i.test(b.brand_color || '') ? b.brand_color : req.tenant.brand_color;
  db.prepare('UPDATE tenants SET name=?, brand_color=?, settings=? WHERE id=?').run(name, color, JSON.stringify(next), TID(req));
  audit(req, 'settings_update', 'tenant', TID(req), '');
  res.json({ ok: true });
});

router.post('/admin/notifications/test', adminOnly, (req, res) => {
  const ch = (req.body || {}).channel;
  const u = req.user;
  if (ch === 'whatsapp') {
    if (!u.phone) throw httpError(422, 'Renseignez d\'abord votre numéro de téléphone dans « Mon profil ».');
    if (!hasFeature(req.license, 'whatsapp')) throw httpError(402, 'WhatsApp n\'est pas inclus dans votre licence.');
    db.prepare("INSERT INTO notifications (tenant_id,user_id,channel,event,recipient,subject,body,link,status,meta) VALUES (?,?,?,?,?,?,?,?,'queued',?)")
      .run(TID(req), u.id, 'whatsapp', 'test', u.phone, 'Test', 'Ceci est un message de test envoyé depuis votre espace.', config.BASE_URL, JSON.stringify({ name: u.name.split(' ')[0], number: 'TEST' }));
  } else {
    queueEmail({ tenantId: TID(req), userId: u.id, to: u.email, event: 'test', subject: `${config.APP_NAME} : e-mail de test`, body: `Bonjour ${u.name.split(' ')[0]},\n\nSi vous lisez ce message, l'envoi d'e-mails fonctionne correctement.`, link: config.BASE_URL });
  }
  flush().catch(() => {});
  res.json({ ok: true });
});

router.get('/admin/notifications', adminOnly, (req, res) => {
  const rows = db.prepare("SELECT n.id, n.channel, n.event, n.recipient, n.subject, n.status, n.error, n.created_at, n.sent_at, u.name AS user_name, f.number FROM notifications n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN fae f ON f.id = n.fae_id WHERE n.tenant_id = ? AND n.channel IN ('email','whatsapp') ORDER BY n.id DESC LIMIT 100").all(TID(req));
  res.json({ rows });
});

router.get('/admin/audit', adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 200').all(TID(req));
  res.json({ rows });
});

// ───────────────────────────── Référentiels : fournisseurs & PSCS
router.get('/admin/suppliers', adminOnly, (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const total = db.prepare('SELECT COUNT(*) c FROM suppliers WHERE tenant_id = ? AND (name LIKE ? OR ref LIKE ?)').get(TID(req), q, q).c;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db.prepare('SELECT * FROM suppliers WHERE tenant_id = ? AND (name LIKE ? OR ref LIKE ?) ORDER BY name LIMIT 50 OFFSET ?').all(TID(req), q, q, (page - 1) * 50);
  res.json({ total, page, rows });
});
router.post('/admin/suppliers', adminOnly, (req, res) => {
  const b = req.body || {}; const name = String(b.name || '').trim();
  if (!name) throw httpError(422, 'Le nom du fournisseur est obligatoire.');
  if (db.prepare('SELECT 1 FROM suppliers WHERE tenant_id = ? AND lower(name) = lower(?)').get(TID(req), name)) throw httpError(409, 'Ce fournisseur existe déjà.');
  const info = db.prepare('INSERT INTO suppliers (tenant_id,ref,name,country,city,currency) VALUES (?,?,?,?,?,?)').run(TID(req), b.ref || null, name, b.country || null, b.city || null, b.currency || null);
  res.status(201).json({ id: info.lastInsertRowid });
});
router.put('/admin/suppliers/:id', adminOnly, (req, res) => {
  const b = req.body || {}; const s = db.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!s) throw httpError(404, 'Fournisseur introuvable.');
  db.prepare('UPDATE suppliers SET ref=?, name=?, country=?, city=?, currency=?, active=? WHERE id=?').run(b.ref ?? s.ref, String(b.name || s.name).trim(), b.country ?? s.country, b.city ?? s.city, b.currency ?? s.currency, b.active !== undefined ? +!!b.active : s.active, s.id);
  res.json({ ok: true });
});
router.delete('/admin/suppliers/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id = ? AND tenant_id = ?').run(Number(req.params.id), TID(req));
  res.json({ ok: true });
});

async function readSheetRows(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw httpError(400, 'Le fichier ne contient aucune feuille.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => { rows.push(row.values.slice(1).map((v) => (v && typeof v === 'object' ? (v.text || v.result || (v.richText ? v.richText.map((r) => r.text).join('') : '')) : v))); });
  return rows;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function colIndex(header, names) { return header.findIndex((h) => names.some((n) => norm(h) === n || norm(h).includes(n))); }

router.post('/admin/suppliers/import', adminOnly, memUpload.single('file'), wrapAsync(async (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu (format .xlsx attendu).');
  const rows = await readSheetRows(req.file.buffer);
  if (rows.length < 2) throw httpError(400, 'Le fichier est vide.');
  const h = rows[0];
  const iName = colIndex(h, ['nom', 'name', 'fournisseur', 'raison']), iRef = colIndex(h, ['ref', 'code', 'numero']), iCountry = colIndex(h, ['pays', 'country']), iCity = colIndex(h, ['ville', 'city']), iCur = colIndex(h, ['devise', 'currency']);
  if (iName < 0) throw httpError(400, 'Colonne « Nom » introuvable en première ligne.');
  const existing = new Set(db.prepare('SELECT lower(name) n FROM suppliers WHERE tenant_id = ?').all(TID(req)).map((r) => r.n));
  const ins = db.prepare('INSERT INTO suppliers (tenant_id,ref,name,country,city,currency) VALUES (?,?,?,?,?,?)');
  let added = 0, skipped = 0;
  db.transaction(() => rows.slice(1).forEach((r) => {
    const name = String(r[iName] || '').trim(); if (!name) return;
    if (existing.has(name.toLowerCase())) { skipped++; return; }
    existing.add(name.toLowerCase());
    ins.run(TID(req), iRef >= 0 ? String(r[iRef] || '') || null : null, name, iCountry >= 0 ? r[iCountry] || null : null, iCity >= 0 ? r[iCity] || null : null, iCur >= 0 ? r[iCur] || null : null);
    added++;
  }))();
  audit(req, 'suppliers_import', 'supplier', null, `${added} ajoutés`);
  res.json({ added, skipped });
}));

router.get('/admin/pscs', adminOnly, (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json({ total: db.prepare('SELECT COUNT(*) c FROM pscs WHERE tenant_id = ?').get(TID(req)).c, rows: db.prepare('SELECT * FROM pscs WHERE tenant_id = ? AND (code LIKE ? OR short_name LIKE ? OR long_name LIKE ?) ORDER BY code LIMIT 100').all(TID(req), q, q, q) });
});
router.post('/admin/pscs/import', adminOnly, memUpload.single('file'), wrapAsync(async (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu (format .xlsx attendu).');
  const rows = await readSheetRows(req.file.buffer);
  const h = rows[0] || [];
  const iCode = colIndex(h, ['code']), iLevel = colIndex(h, ['niveau', 'level']), iShort = colIndex(h, ['court', 'short', 'libelle', 'nom']), iLong = colIndex(h, ['long']), iDesc = colIndex(h, ['description', 'desc']);
  if (iCode < 0 || iShort < 0) throw httpError(400, 'Colonnes « Code » et « Libellé » obligatoires en première ligne.');
  const mode = (req.body || {}).mode === 'replace' ? 'replace' : 'append';
  const ins = db.prepare('INSERT INTO pscs (tenant_id,code,level,short_name,long_name,description) VALUES (?,?,?,?,?,?)');
  let added = 0;
  db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM pscs WHERE tenant_id = ?').run(TID(req));
    const have = new Set(db.prepare('SELECT code FROM pscs WHERE tenant_id = ?').all(TID(req)).map((r) => r.code));
    rows.slice(1).forEach((r) => {
      const code = String(r[iCode] || '').trim(); if (!code || have.has(code)) return; have.add(code);
      ins.run(TID(req), code, iLevel >= 0 ? r[iLevel] || null : (code.length <= 2 ? 'Segment' : code.length <= 4 ? 'Famille' : 'Classe'), String(r[iShort] || '').trim(), iLong >= 0 ? r[iLong] || null : null, iDesc >= 0 ? r[iDesc] || null : null); added++;
    });
  })();
  res.json({ added });
}));

module.exports = router;
