'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { issueSession, clearSession, requireAuth, publicUser } = require('../auth');
const { audit, jparse, randomToken, sha256, nowSql, httpError, ROLES, STATUS_LABELS } = require('../lib/util');
const { loadModel } = require('../lib/model');
const { PLANS, ALL_FEATURES, countUsers, countFaeThisMonth } = require('../lib/license');
const { queueEmail, EVENT_LABELS, DEFAULT_TEMPLATES } = require('../lib/notify');
const { pendingFor } = require('../lib/workflow');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' } });

function strongEnough(pw) { return typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw); }

router.post('/auth/login', loginLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const u = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  const fail = () => res.status(401).json({ error: 'Identifiants incorrects.' });
  if (!u || !u.active) return fail();
  if (u.locked_until && u.locked_until > nowSql()) return res.status(429).json({ error: 'Compte temporairement verrouillé après trop d\'échecs. Réessayez dans 15 minutes.' });
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(n >= 8 ? 0 : n, n >= 8 ? new Date(Date.now() + 15 * 60e3).toISOString().replace('T', ' ').slice(0, 19) : null, u.id);
    return fail();
  }
  if (u.tenant_id) {
    const t = db.prepare('SELECT status FROM tenants WHERE id = ?').get(u.tenant_id);
    if (!t || t.status !== 'active') return res.status(403).json({ error: 'Ce compte client est suspendu.' });
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?').run(nowSql(), u.id);
  issueSession(res, u);
  audit({ user: u, ip: req.ip }, 'login', 'user', u.id, '');
  res.json({ user: publicUser(u) });
});

router.post('/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

router.post('/auth/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) throw httpError(400, 'Mot de passe actuel incorrect.');
  if (!strongEnough(next)) throw httpError(422, 'Le nouveau mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  issueSession(res, fresh);
  audit(req, 'password_change', 'user', req.user.id, '');
  res.json({ ok: true });
});

router.post('/auth/forgot', loginLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1').get(email);
  if (u) {
    const token = randomToken(24);
    db.prepare('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?').run(sha256(token), new Date(Date.now() + 3600e3).toISOString().replace('T', ' ').slice(0, 19), u.id);
    queueEmail({ tenantId: u.tenant_id, userId: u.id, to: u.email, event: 'reset', subject: `${config.APP_NAME} : réinitialisation du mot de passe`, body: `Bonjour ${u.name.split(' ')[0]},\n\nVous avez demandé à réinitialiser votre mot de passe. Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`, link: `${config.BASE_URL}/#/reset/${token}` });
  }
  res.json({ ok: true, message: 'Si cette adresse existe, un e-mail de réinitialisation vient d\'être envoyé.' });
});

router.post('/auth/reset', loginLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!strongEnough(password)) throw httpError(422, 'Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
  const u = db.prepare('SELECT * FROM users WHERE reset_token_hash = ? AND reset_expires > ?').get(sha256(String(token || '')), nowSql());
  if (!u) throw httpError(400, 'Lien invalide ou expiré. Refaites une demande.');
  db.prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires = NULL, must_change = 0, failed_logins = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  audit({ user: u, ip: req.ip }, 'password_reset', 'user', u.id, '');
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null, app: { name: config.APP_NAME } });
  res.json({ user: publicUser(req.user), app: { name: config.APP_NAME } });
});

/** Tout ce dont l'interface a besoin au démarrage. */
router.get('/bootstrap', requireAuth, (req, res) => {
  const u = req.user;
  const base = { app: { name: config.APP_NAME, base_url: config.BASE_URL }, user: publicUser(u), roles: ROLES, status_labels: STATUS_LABELS, plans: PLANS, features: ALL_FEATURES };
  if (!u.tenant_id) return res.json(base);
  const model = loadModel(u.tenant_id);
  const lic = req.license;
  const settings = model.settings;
  const steps = db.prepare('SELECT * FROM workflow_steps WHERE tenant_id = ? ORDER BY position, id').all(u.tenant_id).map((s) => ({ ...s, condition: jparse(s.condition, null) }));
  const users = db.prepare('SELECT id, name, role, active FROM users WHERE tenant_id = ? ORDER BY name').all(u.tenant_id);
  const unread = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND channel = 'inapp' AND read_at IS NULL").get(u.id).c;
  const pending = pendingFor(u).length;
  res.json({
    ...base,
    tenant: { id: req.tenant.id, name: req.tenant.name, brand_color: req.tenant.brand_color },
    license: { plan: lic.plan, plan_label: (PLANS[lic.plan] || {}).label || lic.plan, state: lic.state, daysLeft: lic.daysLeft, features: lic.features, max_users: lic.max_users, max_fae_month: lic.max_fae_month, expires_at: lic.expires_at, used_users: countUsers(u.tenant_id), used_fae: countFaeThisMonth(u.tenant_id), readOnly: lic.readOnly },
    sections: model.sections, fields: model.allFields.map((f) => ({ ...f })), lists: model.lists,
    settings: { max_offers: settings.max_offers, controls: settings.controls, buyers_see_all: !!settings.buyers_see_all, number_prefix: settings.number_prefix, notifications: settings.notifications },
    workflow: steps, users, unread, pending,
    event_labels: EVENT_LABELS, default_templates: DEFAULT_TEMPLATES
  });
});

module.exports = router;
