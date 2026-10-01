'use strict';
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { jparse, httpError } = require('./util');

const ALL_FEATURES = {
  custom_fields: 'Champs personnalisés',
  workflow_builder: 'Workflow de validation configurable',
  whatsapp: 'Alertes WhatsApp',
  bulk_export: 'Extractions en masse (XLSX / PDF)',
  attachments: 'Pièces jointes',
  budgets: 'Suivi budgétaire annuel',
  advanced_dashboards: 'Tableaux de bord avancés'
};

const PLANS = {
  starter: {
    label: 'Starter', max_users: 5, max_fae_month: 40,
    features: ['attachments'],
    hint: 'Petite équipe achats — champs de base, workflow 2 étapes, exports CSV.'
  },
  business: {
    label: 'Business', max_users: 25, max_fae_month: 400,
    features: ['custom_fields', 'workflow_builder', 'whatsapp', 'bulk_export', 'attachments', 'budgets'],
    hint: 'Direction achats — formulaire modulable, workflow libre, alertes WhatsApp, exports complets.'
  },
  enterprise: {
    label: 'Enterprise', max_users: 200, max_fae_month: 0,
    features: Object.keys(ALL_FEATURES),
    hint: 'Groupe / multi-sites — toutes les fonctions, volumes illimités.'
  }
};

const GRACE_DAYS = 7;

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function sign(payload) { return crypto.createHmac('sha256', config.LICENSE_SECRET).update(payload).digest('base64url').slice(0, 22); }

/** Génère une clé signée : AF1.<payload>.<signature> */
function makeKey(data) {
  const payload = b64({ t: data.slug, p: data.plan, u: data.max_users, m: data.max_fae_month, f: data.features, e: data.expires_at, i: Date.now().toString(36) });
  return `AF1.${payload}.${sign(payload)}`;
}

function readKey(key) {
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'AF1') throw httpError(400, 'Format de clé de licence invalide.');
  const expected = sign(parts[1]);
  const a = Buffer.from(parts[2]); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(400, 'Clé de licence invalide (signature incorrecte).');
  const d = jparse(Buffer.from(parts[1], 'base64url').toString('utf8'), null);
  if (!d) throw httpError(400, 'Clé de licence illisible.');
  return { slug: d.t, plan: d.p, max_users: d.u, max_fae_month: d.m, features: d.f || [], expires_at: d.e };
}

function getLicense(tenantId) {
  const row = db.prepare('SELECT * FROM licenses WHERE tenant_id = ?').get(tenantId);
  if (!row) return null;
  const features = jparse(row.features, []);
  const today = new Date().toISOString().slice(0, 10);
  let state = 'active';
  let daysLeft = null;
  if (row.status === 'suspended') state = 'suspended';
  else if (row.expires_at) {
    daysLeft = Math.ceil((new Date(row.expires_at + 'T23:59:59Z') - new Date()) / 86400e3);
    if (row.expires_at < today) state = daysLeft >= -GRACE_DAYS ? 'grace' : 'expired';
    else if (daysLeft <= 30) state = 'expiring';
  }
  return { ...row, features, state, daysLeft, readOnly: state === 'expired' || state === 'suspended' };
}

function hasFeature(lic, f) { return !!(lic && lic.features.includes(f)); }

function requireFeature(feature) {
  return (req, res, next) => {
    if (!hasFeature(req.license, feature)) {
      return res.status(402).json({ error: `La fonction « ${ALL_FEATURES[feature] || feature} » n'est pas incluse dans votre licence (${(PLANS[req.license && req.license.plan] || {}).label || 'actuelle'}).`, code: 'FEATURE_LOCKED', feature });
    }
    next();
  };
}

function countUsers(tenantId) {
  return db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND active = 1').get(tenantId).c;
}
function countFaeThisMonth(tenantId) {
  return db.prepare("SELECT COUNT(*) c FROM fae WHERE tenant_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')").get(tenantId).c;
}

module.exports = { ALL_FEATURES, PLANS, GRACE_DAYS, makeKey, readKey, getLicense, hasFeature, requireFeature, countUsers, countFaeThisMonth };
