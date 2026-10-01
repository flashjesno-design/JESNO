'use strict';
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { getLicense } = require('./lib/license');

const COOKIE = 'af_session';

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, tv: user.token_version }, config.JWT_SECRET, { expiresIn: `${config.SESSION_HOURS}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, maxAge: config.SESSION_HOURS * 3600e3, path: '/' });
}
function clearSession(res) { res.clearCookie(COOKIE, { path: '/' }); }

function loadSession(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next();
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(p.uid);
    if (!user || user.token_version !== p.tv) return next();
    req.user = user;
    if (user.tenant_id) {
      req.tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(user.tenant_id);
      req.license = getLicense(user.tenant_id);
    }
  } catch (e) { /* session invalide */ }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Session expirée : reconnectez-vous.', code: 'UNAUTHENTICATED' });
  if (req.user.tenant_id && (!req.tenant || req.tenant.status !== 'active')) return res.status(403).json({ error: 'Ce compte client est suspendu. Contactez votre fournisseur.', code: 'TENANT_SUSPENDED' });
  next();
}

function requireTenantUser(req, res, next) {
  if (!req.user || !req.user.tenant_id) return res.status(403).json({ error: 'Accès réservé aux utilisateurs d\'un compte client.' });
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Vous n\'avez pas les droits nécessaires pour cette action.' });
  next();
};

/** Licence expirée/suspendue : lecture seule (les exports restent possibles). */
function licenseGuard(req, res, next) {
  if (!req.license || !req.license.readOnly) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const allowed = ['/api/auth/', '/api/admin/license/activate'];
  if (allowed.some((p) => req.originalUrl.startsWith(p))) return next();
  return res.status(402).json({ error: req.license.state === 'suspended' ? 'Licence suspendue : le compte est en lecture seule.' : 'Licence expirée : le compte est en lecture seule. Renouvelez votre licence pour reprendre la saisie.', code: 'LICENSE_READONLY' });
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, tenant_id: u.tenant_id, department: u.department,
    notif_email: !!u.notif_email, notif_whatsapp: !!u.notif_whatsapp, notif_inapp: !!u.notif_inapp,
    delegate_id: u.delegate_id, delegate_until: u.delegate_until, must_change: !!u.must_change, active: !!u.active, last_login: u.last_login
  };
}

module.exports = { COOKIE, issueSession, clearSession, loadSession, requireAuth, requireTenantUser, requireRole, licenseGuard, publicUser };
