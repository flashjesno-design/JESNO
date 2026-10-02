'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { requireRole, requireTenantUser } = require('../auth');
const { requireFeature, countFaeThisMonth } = require('../lib/license');
const { loadModel, computeCalcs, computeMetrics, runChecks } = require('../lib/model');
const svc = require('../lib/fae-service');
const wf = require('../lib/workflow');
const { notify } = require('../lib/notify');
const { httpError, audit, sha256, randomToken, jparse } = require('../lib/util');
const { renderFaePdf } = require('../lib/pdf');

const router = express.Router();
router.use(requireTenantUser);

const UP_DIR = path.join(config.DATA_DIR, 'uploads');
const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt', '.msg', '.eml', '.zip'];
const upload = multer({
  storage: multer.diskStorage({ destination: UP_DIR, filename: (req, file, cb) => cb(null, randomToken(16)) }),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => { const ext = path.extname(file.originalname).toLowerCase(); cb(ALLOWED_EXT.includes(ext) ? null : httpError(400, `Type de fichier non autorisé (${ext || 'inconnu'}).`), ALLOWED_EXT.includes(ext)); }
});

function load(req, { forEdit = false } = {}) {
  const row = svc.getRow(Number(req.params.id), req.user.tenant_id);
  const model = loadModel(req.user.tenant_id);
  if (!row || !svc.canView(req.user, row, model.settings)) throw httpError(404, 'FAE introuvable.');
  if (forEdit) {
    if (row.buyer_id !== req.user.id) throw httpError(403, 'Seul l\'acheteur ayant créé la FAE peut la modifier.');
    if (!['draft', 'rejected'].includes(row.status)) throw httpError(409, 'Cette FAE n\'est plus modifiable (en validation ou déjà validée). Rappelez-la pour la modifier.');
  }
  return { row, model };
}

router.get('/fae', (req, res) => {
  const model = loadModel(req.user.tenant_id);
  res.json(svc.list(req.user, model.settings, req.query));
});

router.get('/fae/approvals', (req, res) => {
  const items = wf.pendingFor(req.user).map((r) => ({
    step_id: r.id, fae_id: r.fae_id, number: r.number, title: r.title, step_name: r.name, supplier_name: r.supplier_name, final: r.final, currency: r.currency, final_xof: r.final_xof,
    buyer_name: r.buyer_name, department: r.department, activated_at: r.activated_at, due_at: r.due_at, overdue: !!(r.due_at && r.due_at < new Date().toISOString().replace('T', ' ').slice(0, 19))
  }));
  res.json({ items });
});

/** Aperçu sans enregistrement : calculs + contrôles (source de vérité serveur). */
router.post('/fae/preview', (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const { data, offers } = svc.sanitize(model, req.body);
  const calc = computeCalcs(model, data, offers);
  const metrics = computeMetrics(model, calc.data, calc.offers);
  res.json({ metrics, issues: runChecks(model, calc.data, calc.offers, metrics, 'submit') });
});

router.post('/fae', requireRole('buyer', 'admin'), (req, res) => {
  const lic = req.license;
  if (lic.max_fae_month && countFaeThisMonth(req.user.tenant_id) >= lic.max_fae_month) throw httpError(402, `Quota mensuel atteint (${lic.max_fae_month} FAE/mois avec votre licence).`, { code: 'QUOTA' });
  const id = svc.save({ tenantId: req.user.tenant_id, user: req.user, id: null, payload: req.body });
  audit(req, 'fae_create', 'fae', id, '');
  res.status(201).json({ id });
});

router.get('/fae/:id', (req, res) => {
  const { row, model } = load(req);
  const out = svc.serialize(row, model, { full: true });
  const step = out.steps.find((s) => s.id === out.current_step_id);
  out.can_act = !!(step && wf.canAct(req.user, step, row));
  out.can_edit = row.buyer_id === req.user.id && ['draft', 'rejected'].includes(row.status);
  out.can_recall = row.buyer_id === req.user.id && row.status === 'in_review';
  const calc = computeCalcs(model, out.data, out.offers);
  const metrics = computeMetrics(model, calc.data, calc.offers);
  out.issues = runChecks(model, calc.data, calc.offers, metrics, 'submit');
  res.json(out);
});

router.put('/fae/:id', requireRole('buyer', 'admin'), (req, res) => {
  const { row } = load(req, { forEdit: true });
  svc.save({ tenantId: req.user.tenant_id, user: req.user, id: row.id, payload: req.body });
  res.json({ id: row.id });
});

router.delete('/fae/:id', (req, res) => {
  const { row } = load(req);
  const mine = row.buyer_id === req.user.id;
  if (!(mine || req.user.role === 'admin')) throw httpError(403, 'Suppression non autorisée.');
  if (!['draft', 'rejected', 'cancelled'].includes(row.status)) throw httpError(409, 'Seule une FAE en brouillon, rejetée ou annulée peut être supprimée.');
  db.prepare('DELETE FROM fae WHERE id = ?').run(row.id);
  audit(req, 'fae_delete', 'fae', row.id, row.number);
  res.json({ ok: true });
});

router.post('/fae/:id/duplicate', requireRole('buyer', 'admin'), (req, res) => {
  const { row, model } = load(req);
  const full = svc.serialize(row, model, { full: true });
  const data = { ...full.data };
  ['fairmarkit_ref', 'pr_number', 'amount_final'].forEach((k) => { if (k in data) data[k] = ''; });
  const offers = full.offers.map((o) => ({ retained: false, data: o.data }));
  const id = svc.save({ tenantId: req.user.tenant_id, user: req.user, id: null, payload: { data, offers } });
  audit(req, 'fae_duplicate', 'fae', id, `depuis ${row.number}`);
  res.status(201).json({ id });
});

router.post('/fae/:id/submit', requireRole('buyer', 'admin'), (req, res) => {
  const { row, model } = load(req, { forEdit: true });
  // enregistre d'abord la dernière version envoyée par le formulaire
  if (req.body && req.body.data) svc.save({ tenantId: req.user.tenant_id, user: req.user, id: row.id, payload: req.body });
  const fresh = svc.getRow(row.id, req.user.tenant_id);
  const full = svc.serialize(fresh, model, { full: true });
  const calc = computeCalcs(model, full.data, full.offers);
  const metrics = computeMetrics(model, calc.data, calc.offers);
  const blockers = runChecks(model, calc.data, calc.offers, metrics, 'submit').filter((i) => i.level === 'block');
  if (blockers.length) return res.status(422).json({ error: 'La FAE ne peut pas être soumise : corrigez les points bloquants.', issues: blockers });
  const updated = wf.submit(fresh, req.user);
  audit(req, 'fae_submit', 'fae', row.id, '');
  res.json({ status: updated.status });
});

router.post('/fae/:id/approve', (req, res) => {
  const { row } = load(req);
  const updated = wf.decide(row, req.user, 'approve', (req.body || {}).comment);
  audit(req, 'fae_approve', 'fae', row.id, (req.body || {}).comment || '');
  res.json({ status: updated.status });
});

router.post('/fae/:id/reject', (req, res) => {
  const { row } = load(req);
  const updated = wf.decide(row, req.user, 'reject', (req.body || {}).comment);
  audit(req, 'fae_reject', 'fae', row.id, (req.body || {}).comment || '');
  res.json({ status: updated.status });
});

router.post('/fae/:id/recall', requireRole('buyer', 'admin'), (req, res) => {
  const { row } = load(req);
  if (row.buyer_id !== req.user.id) throw httpError(403, 'Seul l\'acheteur peut rappeler sa FAE.');
  const updated = wf.recall(row, req.user);
  res.json({ status: updated.status });
});

router.post('/fae/:id/cancel', requireRole('buyer', 'admin'), (req, res) => {
  const { row } = load(req);
  if (!(row.buyer_id === req.user.id || req.user.role === 'admin')) throw httpError(403, 'Action non autorisée.');
  if (!['draft', 'rejected'].includes(row.status)) throw httpError(409, 'Rappelez d\'abord la FAE pour pouvoir l\'annuler.');
  db.prepare("UPDATE fae SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(row.id);
  wf.logEvent(row, req.user, 'cancelled', (req.body || {}).comment || 'FAE annulée');
  res.json({ status: 'cancelled' });
});

router.post('/fae/:id/comment', (req, res) => {
  const { row } = load(req);
  const text = String((req.body || {}).text || '').trim().slice(0, 1500);
  if (!text) throw httpError(422, 'Le commentaire est vide.');
  wf.logEvent(row, req.user, 'comment', text);
  const steps = db.prepare("SELECT * FROM fae_steps WHERE fae_id=? AND cycle=? AND status='pending'").all(row.id, row.cycle);
  const targets = new Set([row.buyer_id]);
  steps.forEach((s) => wf.eligibleApprovers(s, row).forEach((u) => targets.add(u.id)));
  targets.delete(req.user.id);
  notify({ tenantId: req.user.tenant_id, userIds: [...targets], event: 'comment', fae: row, vars: { actor: req.user.name, comment: text } });
  res.status(201).json({ ok: true });
});

router.get('/fae/:id/pdf', (req, res) => {
  const { row, model } = load(req);
  const full = svc.serialize(row, model, { full: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${row.number}.pdf"`);
  renderFaePdf(res, [full], model, req.tenant);
});

// ── Pièces jointes
router.post('/fae/:id/attachments', requireFeature('attachments'), (req, res, next) => {
  const { row } = load(req);
  if (['approved', 'cancelled'].includes(row.status)) throw httpError(409, 'Cette FAE est clôturée.');
  req._faeRow = row; next();
}, upload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu.');
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').replace(/[\\/\r\n]/g, '_').slice(0, 180);
  db.prepare('INSERT INTO attachments (fae_id,tenant_id,filename,stored,size,mime,uploaded_by) VALUES (?,?,?,?,?,?,?)').run(req._faeRow.id, req.user.tenant_id, name, req.file.filename, req.file.size, req.file.mimetype, req.user.id);
  wf.logEvent(req._faeRow, req.user, 'attachment', `Pièce jointe ajoutée : ${name}`);
  res.status(201).json({ ok: true });
});

router.get('/fae/:id/attachments/:aid', (req, res) => {
  const { row } = load(req);
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND fae_id = ?').get(Number(req.params.aid), row.id);
  if (!a) throw httpError(404, 'Pièce jointe introuvable.');
  const file = path.join(UP_DIR, a.stored);
  if (!fs.existsSync(file)) throw httpError(404, 'Fichier absent du serveur.');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(file, a.filename);
});

router.delete('/fae/:id/attachments/:aid', (req, res) => {
  const { row } = load(req);
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND fae_id = ?').get(Number(req.params.aid), row.id);
  if (!a) throw httpError(404, 'Pièce jointe introuvable.');
  if (!(a.uploaded_by === req.user.id || req.user.role === 'admin')) throw httpError(403, 'Suppression non autorisée.');
  if (['approved'].includes(row.status)) throw httpError(409, 'FAE clôturée.');
  try { fs.unlinkSync(path.join(UP_DIR, a.stored)); } catch (e) { /* déjà supprimé */ }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

module.exports = router;
