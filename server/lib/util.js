'use strict';
const crypto = require('crypto');
const db = require('../db');

const ROLES = {
  admin: 'Administrateur',
  buyer: 'Acheteur',
  manager: 'Manager / Directeur achats',
  ops_manager: 'Responsable opérationnel',
  director: 'Directeur opérationnel',
  viewer: 'Lecture seule (contrôle de gestion)'
};

const STATUS_LABELS = {
  draft: 'Brouillon',
  in_review: 'En validation',
  approved: 'Validée',
  rejected: 'Rejetée (à corriger)',
  cancelled: 'Annulée'
};

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const todayIso = () => new Date().toISOString().slice(0, 10);
const addHours = (h, from) => new Date((from ? new Date(from.replace(' ', 'T') + 'Z') : new Date()).getTime() + h * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
const parseSql = (s) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? 'Z' : '')) : null);

function jparse(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function tempPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += alphabet[crypto.randomInt(alphabet.length)];
  return p + crypto.randomInt(10, 99);
}

function audit(req, action, entity, entityId, detail) {
  try {
    const u = req && req.user;
    db.prepare('INSERT INTO audit_log (tenant_id,user_id,user_name,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?,?)')
      .run(u ? u.tenant_id : null, u ? u.id : null, u ? u.name : null, action, entity || null, entityId != null ? String(entityId) : null,
        typeof detail === 'string' ? detail : JSON.stringify(detail || {}), req ? (req.ip || '') : '');
  } catch (e) { console.error('audit', e.message); }
}

function slugify(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
}

const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(status, message, extra) {
  const e = new Error(message); e.status = status; if (extra) e.extra = extra; return e;
}

module.exports = { ROLES, STATUS_LABELS, nowSql, todayIso, addHours, parseSql, jparse, toNum, randomToken, sha256, tempPassword, audit, slugify, httpError, wrapAsync };
