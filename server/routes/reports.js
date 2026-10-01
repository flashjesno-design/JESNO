'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireTenantUser } = require('../auth');
const { requireFeature, hasFeature } = require('../lib/license');
const { loadModel } = require('../lib/model');
const svc = require('../lib/fae-service');
const { dashboard } = require('../lib/analytics');
const { renderFaePdf } = require('../lib/pdf');
const { jparse, audit, httpError, STATUS_LABELS, wrapAsync } = require('../lib/util');

const router = express.Router();
router.use(requireTenantUser);

// ───────────────────────────── Lookups (autocomplétion)
router.get('/lookup/pscs', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = q
    ? db.prepare("SELECT code, level, short_name, long_name, description FROM pscs WHERE tenant_id = ? AND level = 'Classe' AND (code LIKE ? OR short_name LIKE ? OR long_name LIKE ? OR description LIKE ? OR name_en LIKE ?) ORDER BY (CASE WHEN code LIKE ? THEN 0 WHEN short_name LIKE ? OR long_name LIKE ? THEN 1 ELSE 2 END), code LIMIT 30").all(req.user.tenant_id, like, like, like, like, like, `${q}%`, like, like)
    : db.prepare("SELECT code, level, short_name, long_name, description FROM pscs WHERE tenant_id = ? AND level = 'Classe' ORDER BY code LIMIT 30").all(req.user.tenant_id);
  const names = {};
  db.prepare("SELECT code, COALESCE(NULLIF(long_name,''), short_name) n FROM pscs WHERE tenant_id = ? AND level IN ('Segment','Famille')").all(req.user.tenant_id).forEach((r) => { names[r.code] = r.n; });
  res.json({ rows: rows.map((r) => ({ ...r, segment: names[r.code.slice(0, 2)] || '', family: names[r.code.slice(0, 4)] || '' })) });
});
router.get('/lookup/pscs/:code', (req, res) => {
  const r = db.prepare('SELECT code, level, short_name, long_name, description FROM pscs WHERE tenant_id = ? AND code = ?').get(req.user.tenant_id, req.params.code);
  if (!r) return res.json({ row: null });
  const nm = (c) => (db.prepare("SELECT COALESCE(NULLIF(long_name,''), short_name) n FROM pscs WHERE tenant_id = ? AND code = ?").get(req.user.tenant_id, c) || {}).n || '';
  res.json({ row: { ...r, segment: nm(r.code.slice(0, 2)), family: nm(r.code.slice(0, 4)) } });
});
router.get('/lookup/suppliers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = db.prepare('SELECT ref, name, country, city, currency FROM suppliers WHERE tenant_id = ? AND active = 1 AND (name LIKE ? OR ref LIKE ?) ORDER BY (CASE WHEN name LIKE ? THEN 0 ELSE 1 END), name LIMIT 20').all(req.user.tenant_id, like, like, `${q}%`);
  res.json({ rows });
});

// ───────────────────────────── Dashboard
router.get('/dashboard', (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const out = dashboard(req.user, model.settings, req.query);
  if (!hasFeature(req.license, 'advanced_dashboards')) {
    // version de base : KPIs, pipeline, évolution, domaines
    const keep = ['kpis', 'pipeline', 'monthly', 'bySegment', 'byDept', 'suppliers', 'alerts', 'budget_year'];
    Object.keys(out).forEach((k) => { if (!keep.includes(k)) delete out[k]; });
    out.limited = true;
  }
  res.json(out);
});

// ───────────────────────────── Extractions
function allRows(req, model) {
  const { where, params } = svc.buildWhere(req.user, model.settings, req.query);
  const rows = db.prepare(`SELECT f.*, u.name AS buyer_name, u.email AS buyer_email FROM fae f JOIN users u ON u.id = f.buyer_id WHERE ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT 20000`).all(params);
  return rows;
}

router.get('/export/count', (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const { where, params } = svc.buildWhere(req.user, model.settings, req.query);
  const r = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(f.final_xof),0) s FROM fae f WHERE ${where}`).get(params);
  res.json({ count: r.c, amount: r.s });
});

const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function buildColumns(model) {
  const fmt = (f) => (f.type === 'calc' ? (f.options || {}).format : f.type);
  const dyn = model.faeFields.filter((f) => f.type !== 'calc' || true).map((f) => ({ header: f.label, key: `d_${f.key}`, get: (r, data) => data[f.key], fmt: fmt(f), width: f.type === 'textarea' ? 40 : 20 }));
  const core = [
    { header: 'N° FAE', key: 'number', get: (r) => r.number, width: 16 },
    { header: 'Statut', key: 'status', get: (r) => STATUS_LABELS[r.status] || r.status, width: 18 },
    { header: 'Acheteur', key: 'buyer', get: (r) => r.buyer_name, width: 22 },
    { header: 'Créée le', key: 'created', get: (r) => r.created_at.slice(0, 10), fmt: 'date', width: 12 },
    { header: 'Soumise le', key: 'submitted', get: (r) => (r.submitted_at || '').slice(0, 10), fmt: 'date', width: 12 },
    { header: 'Validée le', key: 'validated', get: (r) => (r.validated_at || '').slice(0, 10), fmt: 'date', width: 12 },
    { header: 'Fournisseur retenu', key: 'supplier', get: (r) => r.supplier_name, width: 32 },
    { header: 'Nb fournisseurs consultés', key: 'offers', get: (r) => r.offers_count, fmt: 'number', width: 12 },
    { header: 'Nb offres conformes', key: 'conform', get: (r) => r.conform_count, fmt: 'number', width: 12 },
    { header: 'Budget (CFA)', key: 'budget_xof', get: (r) => r.budget_xof, fmt: 'money', width: 18 },
    { header: 'Montant final (CFA)', key: 'final_xof', get: (r) => r.final_xof, fmt: 'money', width: 18 },
    { header: 'Savings budget (CFA)', key: 'saving_xof', get: (r) => r.saving_budget_xof, fmt: 'money', width: 18 },
    { header: 'Effort acheteur (CFA)', key: 'effort_xof', get: (r) => r.effort_xof, fmt: 'money', width: 18 }
  ];
  return { core, dyn };
}

router.get('/export/xlsx', requireFeature('bulk_export'), wrapAsync(async (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const rows = allRows(req, model);
  const { core, dyn } = buildColumns(model);
  const wb = new ExcelJS.Workbook();
  wb.creator = req.tenant.name; wb.created = new Date();

  // Feuille 1 : synthèse (une ligne par FAE)
  const ws = wb.addWorksheet('FAE', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  const cols = [...core, ...dyn.filter((c) => !core.some((k) => k.header === c.header))];
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  rows.forEach((r) => {
    const data = jparse(r.data, {});
    const o = {}; cols.forEach((c) => { let v = c.get(r, data); if (c.fmt === 'date' && v) v = new Date(String(v).slice(0, 10) + 'T00:00:00Z'); if (v === '' || v === undefined) v = null; o[c.key] = v; });
    ws.addRow(o);
  });
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.alignment = { vertical: 'middle', wrapText: true }; head.height = 32;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } }; });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.fmt === 'money') col.numFmt = '#,##0';
    else if (c.fmt === 'percent') col.numFmt = '0.0%';
    else if (c.fmt === 'date') col.numFmt = 'dd/mm/yyyy';
    else if (c.fmt === 'number') col.numFmt = '#,##0.##';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // Feuille 2 : détail des fournisseurs consultés
  const wo = wb.addWorksheet('Fournisseurs consultés', { views: [{ state: 'frozen', ySplit: 1 }] });
  const offerCols = model.offerFields.map((f) => ({ header: f.label, key: f.key, width: 22, fmt: f.type === 'calc' ? (f.options || {}).format : f.type }));
  wo.columns = [{ header: 'N° FAE', key: '_n', width: 16 }, { header: 'Retenu', key: '_r', width: 9 }, ...offerCols];
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const byId = {}; rows.forEach((r) => { byId[r.id] = r; });
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      db.prepare(`SELECT * FROM offers WHERE fae_id IN (${chunk.map(() => '?').join(',')}) ORDER BY fae_id, position`).all(...chunk).forEach((o) => {
        const d = jparse(o.data, {});
        wo.addRow({ _n: byId[o.fae_id].number, _r: o.retained ? 'OUI' : '', ...d });
      });
    }
  }
  const h2 = wo.getRow(1); h2.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h2.height = 28;
  h2.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4531A' } }; });
  offerCols.forEach((c, i) => { if (c.fmt === 'money') wo.getColumn(i + 3).numFmt = '#,##0'; });
  wo.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: offerCols.length + 2 } };

  // Feuille 3 : critères de l'extraction
  const wi = wb.addWorksheet('Critères');
  wi.columns = [{ width: 28 }, { width: 60 }];
  wi.addRows([['Extraction', `${req.tenant.name}`], ['Générée le', new Date().toLocaleString('fr-FR')], ['Par', req.user.name], ['Nombre de FAE', rows.length], ...Object.entries(req.query).filter(([, v]) => v).map(([k, v]) => [k, String(v)])]);
  wi.getColumn(1).font = { bold: true };

  audit(req, 'export_xlsx', 'fae', null, `${rows.length} lignes ${JSON.stringify(req.query)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="extraction-fae-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

router.get('/export/csv', (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const rows = allRows(req, model);
  const { core } = buildColumns(model);
  const lines = [core.map((c) => csvCell(c.header)).join(';')];
  rows.forEach((r) => lines.push(core.map((c) => csvCell(c.get(r, {}))).join(';')));
  audit(req, 'export_csv', 'fae', null, `${rows.length} lignes`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="extraction-fae-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

router.get('/export/pdf', requireFeature('bulk_export'), (req, res) => {
  const model = loadModel(req.user.tenant_id);
  const rows = allRows(req, model).slice(0, 200);
  if (!rows.length) throw httpError(404, 'Aucune FAE ne correspond à ces critères.');
  const full = rows.map((r) => svc.serialize(r, model, { full: true }));
  audit(req, 'export_pdf', 'fae', null, `${rows.length} fiches`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fiches-fae-${new Date().toISOString().slice(0, 10)}.pdf"`);
  renderFaePdf(res, full, model, req.tenant);
});

// ───────────────────────────── Notifications personnelles
router.get('/notifications', (req, res) => {
  const rows = db.prepare("SELECT id, fae_id, event, subject, body, link, read_at, created_at FROM notifications WHERE user_id = ? AND channel = 'inapp' ORDER BY id DESC LIMIT 40").all(req.user.id);
  res.json({ rows, unread: rows.filter((r) => !r.read_at).length });
});
router.post('/notifications/read', (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND channel = 'inapp' AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
