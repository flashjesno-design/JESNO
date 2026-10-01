'use strict';
/* Console éditeur : création des comptes clients, licences, suspension. Réservé au super-administrateur. */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { PLANS, ALL_FEATURES, makeKey, getLicense, countUsers, countFaeThisMonth } = require('../lib/license');
const { provisionTenant } = require('../lib/defaults');
const { queueEmail } = require('../lib/notify');
const { httpError, slugify, tempPassword, audit, jparse } = require('../lib/util');

const router = express.Router();
router.use('/super', (req, res, next) => {
  if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'Console réservée à l\'éditeur.' });
  next();
});

const addMonths = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

function tenantRow(t) {
  const lic = getLicense(t.id);
  return {
    id: t.id, name: t.name, slug: t.slug, status: t.status, created_at: t.created_at,
    plan: lic && lic.plan, license_state: lic && lic.state, expires_at: lic && lic.expires_at, max_users: lic && lic.max_users, max_fae_month: lic && lic.max_fae_month, features: lic ? lic.features : [],
    users: countUsers(t.id), fae_month: countFaeThisMonth(t.id), fae_total: db.prepare('SELECT COUNT(*) c FROM fae WHERE tenant_id = ?').get(t.id).c,
    license_key: lic && lic.license_key
  };
}

router.get('/super/tenants', (req, res) => {
  res.json({ tenants: db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all().map(tenantRow), plans: PLANS, features: ALL_FEATURES });
});

router.post('/super/tenants', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const adminEmail = String(b.admin_email || '').trim().toLowerCase();
  const adminName = String(b.admin_name || '').trim();
  if (!name || !adminName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw httpError(422, 'Nom du client, nom et e-mail de l\'administrateur sont obligatoires.');
  if (!PLANS[b.plan]) throw httpError(422, 'Plan invalide.');
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(adminEmail)) throw httpError(409, 'Cette adresse e-mail est déjà utilisée.');
  let slug = slugify(name); const base = slug; let i = 1;
  while (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) slug = `${base}-${++i}`;
  const plan = PLANS[b.plan];
  const months = Math.max(1, parseInt(b.months, 10) || 12);
  const expires = b.expires_at || addMonths(months);
  const maxUsers = parseInt(b.max_users, 10) || plan.max_users;
  const maxFae = b.max_fae_month !== undefined && b.max_fae_month !== '' ? parseInt(b.max_fae_month, 10) : plan.max_fae_month;
  const features = Array.isArray(b.features) && b.features.length ? b.features.filter((f) => ALL_FEATURES[f]) : plan.features;
  const pwd = tempPassword();
  let tid;
  db.transaction(() => {
    tid = db.prepare('INSERT INTO tenants (name,slug,brand_color) VALUES (?,?,?)').run(name, slug, /^#[0-9a-f]{6}$/i.test(b.brand_color || '') ? b.brand_color : '#2f5d8a').lastInsertRowid;
    // Les référentiels (nomenclature PSCS, base fournisseurs) sont propres à chaque client : jamais préchargés sans demande explicite.
    provisionTenant(tid, { withReference: (b.load_pscs || b.load_suppliers) ? { pscs: !!b.load_pscs, suppliers: !!b.load_suppliers } : false });
    const key = makeKey({ slug, plan: b.plan, max_users: maxUsers, max_fae_month: maxFae, features, expires_at: expires });
    db.prepare('INSERT INTO licenses (tenant_id,plan,license_key,max_users,max_fae_month,features,starts_at,expires_at,status) VALUES (?,?,?,?,?,?,date(\'now\'),?,\'active\')').run(tid, b.plan, key, maxUsers, maxFae, JSON.stringify(features), expires);
    db.prepare('INSERT INTO users (tenant_id,email,name,phone,role,password_hash,must_change) VALUES (?,?,?,?,?,?,1)').run(tid, adminEmail, adminName, b.admin_phone || null, 'admin', bcrypt.hashSync(pwd, 10));
  })();
  queueEmail({ tenantId: tid, to: adminEmail, event: 'invite', subject: `Votre espace ${config.APP_NAME} est prêt`, body: `Bonjour ${adminName.split(' ')[0]},\n\nL'espace « ${name} » a été créé sur ${config.APP_NAME}.\n\nIdentifiant : ${adminEmail}\nMot de passe temporaire : ${pwd}\n\nConnectez-vous, changez votre mot de passe puis créez vos utilisateurs (acheteurs, managers, directeurs).`, link: config.BASE_URL });
  audit(req, 'tenant_create', 'tenant', tid, `${name} (${b.plan})`);
  res.status(201).json({ id: tid, slug, temp_password: pwd, tenant: tenantRow(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid)) });
});

router.put('/super/tenants/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(Number(req.params.id));
  if (!t) throw httpError(404, 'Client introuvable.');
  const b = req.body || {};
  const lic = getLicense(t.id);
  db.transaction(() => {
    if (b.status && ['active', 'suspended'].includes(b.status)) db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(b.status, t.id);
    if (b.name) db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(String(b.name).trim(), t.id);
    const plan = b.plan && PLANS[b.plan] ? b.plan : lic.plan;
    const planChanged = plan !== lic.plan;
    const features = Array.isArray(b.features) ? b.features.filter((f) => ALL_FEATURES[f]) : (planChanged ? PLANS[plan].features : lic.features);
    const maxUsers = b.max_users ? parseInt(b.max_users, 10) : (planChanged ? PLANS[plan].max_users : lic.max_users);
    const maxFae = b.max_fae_month !== undefined && b.max_fae_month !== '' ? parseInt(b.max_fae_month, 10) : (planChanged ? PLANS[plan].max_fae_month : lic.max_fae_month);
    const expires = b.expires_at || (b.extend_months ? (() => { const base = lic.expires_at && lic.expires_at > new Date().toISOString().slice(0, 10) ? new Date(lic.expires_at) : new Date(); base.setMonth(base.getMonth() + parseInt(b.extend_months, 10)); return base.toISOString().slice(0, 10); })() : lic.expires_at);
    const key = makeKey({ slug: t.slug, plan, max_users: maxUsers, max_fae_month: maxFae, features, expires_at: expires });
    db.prepare("UPDATE licenses SET plan=?, license_key=?, max_users=?, max_fae_month=?, features=?, expires_at=?, status=?, updated_at=datetime('now') WHERE tenant_id=?")
      .run(plan, key, maxUsers, maxFae, JSON.stringify(features), expires, b.status === 'suspended' ? 'suspended' : (b.status === 'active' ? 'active' : lic.status), t.id);
  })();
  audit(req, 'tenant_update', 'tenant', t.id, JSON.stringify(b));
  res.json({ tenant: tenantRow(db.prepare('SELECT * FROM tenants WHERE id = ?').get(t.id)) });
});

router.get('/super/audit', (req, res) => {
  res.json({ rows: db.prepare('SELECT a.*, t.name AS tenant FROM audit_log a LEFT JOIN tenants t ON t.id = a.tenant_id ORDER BY a.id DESC LIMIT 200').all() });
});

module.exports = router;
