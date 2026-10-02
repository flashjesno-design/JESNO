'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { loadSession, licenseGuard } = require('./auth');
const { tick } = require('./lib/workflow');
const { flush } = require('./lib/notify');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    hsts: config.NODE_ENV === 'production'
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // protection CSRF simple : les requêtes qui modifient des données doivent venir du même site
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origine non autorisée.' });
    next();
  });

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true, app: config.APP_NAME }); });

  const api = express.Router();
  api.use(loadSession);
  api.use(require('./routes/session'));
  api.use((req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Session expirée : reconnectez-vous.', code: 'UNAUTHENTICATED' })));
  api.use(licenseGuard);
  api.use(require('./routes/super'));
  api.use(require('./routes/fae'));
  api.use(require('./routes/suppliers'));
  api.use(require('./routes/reports'));
  api.use(require('./routes/admin'));
  api.use((req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));
  api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Fichier trop volumineux (max ${config.MAX_UPLOAD_MB} Mo).` });
    const status = err.status || 500;
    if (status >= 500) console.error('[erreur]', req.method, req.originalUrl, err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur.' : err.message, ...(err.extra || {}) });
  });
  app.use('/api', api);

  const pub = path.join(config.ROOT, 'public');
  app.use('/shared', express.static(path.join(config.ROOT, 'shared'), { maxAge: '1h' }));
  app.use('/guides', express.static(path.join(config.ROOT, 'docs'), { maxAge: '1h' }));
  app.use(express.static(pub, { maxAge: config.NODE_ENV === 'production' ? '1h' : 0, etag: true }));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  return app;
}

function ensureSuperAdmin() {
  if (!config.SUPERADMIN_EMAIL || !config.SUPERADMIN_PASSWORD) return;
  const email = config.SUPERADMIN_EMAIL.toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!u) {
    db.prepare("INSERT INTO users (tenant_id,email,name,role,password_hash) VALUES (NULL,?,?, 'superadmin',?)").run(email, 'Éditeur ' + config.APP_NAME, bcrypt.hashSync(config.SUPERADMIN_PASSWORD, 10));
    console.log(`[super-admin] compte créé : ${email}`);
  } else if (u.role !== 'superadmin') {
    console.warn(`[super-admin] ATTENTION : l'identifiant « ${email} » appartient déjà à un utilisateur d'entreprise ; choisissez une autre valeur pour SUPERADMIN_EMAIL.`);
  } else if (!bcrypt.compareSync(config.SUPERADMIN_PASSWORD, u.password_hash)) {
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(config.SUPERADMIN_PASSWORD, 10), u.id);
    console.log('[super-admin] mot de passe synchronisé avec la variable d\'environnement');
  }
}

function start() {
  ensureSuperAdmin();
  if (config.SEED_DEMO && !db.prepare('SELECT 1 FROM tenants LIMIT 1').get()) require('../scripts/seed-demo').run();
  const app = createApp();
  const server = app.listen(config.PORT, () => console.log(`${config.APP_NAME} démarré sur ${config.BASE_URL} (port ${config.PORT}, ${config.NODE_ENV})`));
  // rappels / escalades toutes les 10 minutes, envoi des messages en attente toutes les minutes
  const t1 = setInterval(() => { try { tick(); } catch (e) { console.error('[tick]', e.message); } }, 10 * 60e3);
  const t2 = setInterval(() => flush().catch((e) => console.error('[flush]', e.message)), 60e3);
  setTimeout(() => { try { tick(); } catch (e) { /* noop */ } flush().catch(() => {}); }, 5000);
  const stop = () => { clearInterval(t1); clearInterval(t2); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return server;
}

if (require.main === module) start();
module.exports = { createApp, start, ensureSuperAdmin };
