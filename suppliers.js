'use strict';
/* Référentiel fournisseurs de l'entreprise : consultation, saisie, import en masse (Excel ou CSV), export. */
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireTenantUser } = require('../auth');
const { audit, httpError, nowSql, wrapAsync } = require('../lib/util');

const router = express.Router();
router.use('/suppliers', requireTenantUser);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const TID = (req) => req.user.tenant_id;
const EDITORS = ['admin', 'buyer', 'manager', 'ops_manager', 'director'];
const canEdit = (req, res, next) => (EDITORS.includes(req.user.role) ? next() : res.status(403).json({ error: 'Votre rôle ne permet pas de modifier les fournisseurs.' }));
const canDelete = (req, res, next) => (['admin', 'manager'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Seuls l\'administrateur et le manager achats peuvent supprimer un fournisseur.' }));

const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Découpe une liste d'adresses (séparées par ; , espace ou /) et sépare valides / invalides. */
function splitEmails(raw) {
  const parts = clean(raw).split(/[;,/\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = [...new Set(parts.filter((x) => EMAIL_RE.test(x)))];
  const bad = parts.filter((x) => !EMAIL_RE.test(x));
  return { ok, bad };
}

const out = (s) => ({ id: s.id, name: s.name, ref: s.ref || '', country: s.country || '', city: s.city || '', email: s.email || '', phone: s.phone || '', currency: s.currency || '', active: !!s.active, updated_at: s.updated_at });

// ── Liste et recherche
router.get('/suppliers', (req, res) => {
  const q = clean(req.query.q); const like = `%${q}%`;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const where = 'tenant_id = ? AND (? = \'\' OR name LIKE ? OR ref LIKE ? OR email LIKE ? OR country LIKE ?)';
  const args = [TID(req), q, like, like, like, like];
  const total = db.prepare(`SELECT COUNT(*) c FROM suppliers WHERE ${where}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM suppliers WHERE ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per).map(out);
  const all = db.prepare('SELECT COUNT(*) c, SUM(CASE WHEN email IS NOT NULL AND email <> \'\' THEN 1 ELSE 0 END) e FROM suppliers WHERE tenant_id = ?').get(TID(req));
  res.json({ total, page, per, rows, stats: { count: all.c, with_email: all.e || 0 }, can_edit: EDITORS.includes(req.user.role), can_delete: ['admin', 'manager'].includes(req.user.role) });
});

function validate(b) {
  const name = clean(b.name); if (!name) throw httpError(422, 'Le nom du fournisseur est obligatoire.');
  const em = splitEmails(b.email);
  if (em.bad.length) throw httpError(422, `Adresse e-mail invalide : ${em.bad.join(', ')}`);
  return { name, ref: clean(b.ref) || null, country: clean(b.country) || null, city: clean(b.city) || null, email: em.ok.join('; ') || null, phone: clean(b.phone) || null, currency: clean(b.currency).toUpperCase() || null };
}

router.post('/suppliers', canEdit, (req, res) => {
  const v = validate(req.body || {});
  if (db.prepare('SELECT 1 FROM suppliers WHERE tenant_id = ? AND lower(name) = lower(?)').get(TID(req), v.name)) throw httpError(409, 'Un fournisseur porte déjà ce nom.');
  if (v.ref && db.prepare('SELECT 1 FROM suppliers WHERE tenant_id = ? AND lower(ref) = lower(?)').get(TID(req), v.ref)) throw httpError(409, 'Ce code fournisseur est déjà utilisé.');
  const id = db.prepare('INSERT INTO suppliers (tenant_id,ref,name,country,city,currency,email,phone,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(TID(req), v.ref, v.name, v.country, v.city, v.currency, v.email, v.phone, nowSql()).lastInsertRowid;
  audit(req, 'supplier_create', 'supplier', id, v.name);
  res.status(201).json({ id });
});

router.put('/suppliers/:id', canEdit, (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), TID(req));
  if (!s) throw httpError(404, 'Fournisseur introuvable.');
  const v = validate({ ...out(s), ...(req.body || {}) });
  if (db.prepare('SELECT 1 FROM suppliers WHERE tenant_id = ? AND lower(name) = lower(?) AND id <> ?').get(TID(req), v.name, s.id)) throw httpError(409, 'Un autre fournisseur porte déjà ce nom.');
  if (v.ref && db.prepare('SELECT 1 FROM suppliers WHERE tenant_id = ? AND lower(ref) = lower(?) AND id <> ?').get(TID(req), v.ref, s.id)) throw httpError(409, 'Ce code fournisseur est déjà utilisé.');
  db.prepare('UPDATE suppliers SET ref=?, name=?, country=?, city=?, currency=?, email=?, phone=?, active=?, updated_at=? WHERE id=?')
    .run(v.ref, v.name, v.country, v.city, v.currency, v.email, v.phone, (req.body || {}).active === false ? 0 : 1, nowSql(), s.id);
  audit(req, 'supplier_update', 'supplier', s.id, v.name);
  res.json({ ok: true });
});

router.delete('/suppliers/:id', canDelete, (req, res) => {
  const r = db.prepare('DELETE FROM suppliers WHERE id = ? AND tenant_id = ?').run(Number(req.params.id), TID(req));
  if (!r.changes) throw httpError(404, 'Fournisseur introuvable.');
  audit(req, 'supplier_delete', 'supplier', req.params.id, '');
  res.json({ ok: true });
});

// ── Modèle et export Excel
const HEADERS = ['Nom fournisseur', 'Code fournisseur', 'Pays', 'E-mails contact', 'Téléphone', 'Ville', 'Devise'];

async function sendWorkbook(res, filename, rows, withExamples) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fournisseurs', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 44 }, { width: 18 }, { width: 18 }, { width: 10 }];
  ws.addRow(HEADERS);
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.height = 24;
  head.eachCell((c, i) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 1 ? 'FFD4501E' : 'FF14213D' } }; c.alignment = { vertical: 'middle' }; });
  rows.forEach((r) => ws.addRow([r.name, r.ref, r.country, r.email, r.phone, r.city, r.currency]));
  if (withExamples) {
    ws.addRow(['SOCIÉTÉ EXEMPLE SARL', 'F-10025', "Côte d'Ivoire", 'commercial@exemple.ci; compta@exemple.ci', '+225 07 00 00 00 00', 'Abidjan', 'CFA']);
    ws.addRow(['EXEMPLE INDUSTRIES SAS', 'F-10026', 'France', 'ventes@exemple.fr', '', 'Lyon', 'EURO']);
    const info = wb.addWorksheet('Mode d\'emploi');
    info.columns = [{ width: 24 }, { width: 90 }];
    [['Colonne', 'Règle'], ['Nom fournisseur', 'Obligatoire. Sert à retrouver le fournisseur s\'il n\'a pas de code.'], ['Code fournisseur', 'Facultatif mais recommandé (ex. code SAP). Si le code existe déjà, la ligne met à jour ce fournisseur.'],
      ['Pays', 'Facultatif.'], ['E-mails contact', 'Facultatif. Plusieurs adresses possibles, séparées par un point-virgule.'], ['Téléphone, Ville, Devise', 'Facultatifs.'],
      ['Format', 'Gardez la première ligne (titres). Vous pouvez aussi enregistrer ce fichier en CSV (séparateur ; ou ,).'], ['Exemples', 'Supprimez les deux lignes d\'exemple avant l\'import.']].forEach((r) => info.addRow(r));
    info.getRow(1).font = { bold: true };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res); res.end();
}

router.get('/suppliers/template.xlsx', wrapAsync(async (req, res) => sendWorkbook(res, 'modele-import-fournisseurs.xlsx', [], true)));
router.get('/suppliers/export.xlsx', wrapAsync(async (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers WHERE tenant_id = ? ORDER BY name COLLATE NOCASE').all(TID(req)).map(out);
  await sendWorkbook(res, `fournisseurs-${new Date().toISOString().slice(0, 10)}.xlsx`, rows, false);
}));

// ── Lecture des fichiers importés
function decodeText(buf) {
  let txt;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
  return txt.replace(/^\uFEFF/, '');
}

function parseCsv(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => clean(x)));
}

async function readXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch (e) { throw httpError(400, 'Fichier Excel illisible. Enregistrez-le au format .xlsx (pas .xls) ou en CSV.'); }
  const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0];
  if (!ws) throw httpError(400, 'Le fichier ne contient aucune feuille.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let i = 1; i <= Math.max(r.cellCount, 7); i++) {
      const v = r.getCell(i).value;
      vals.push(v && typeof v === 'object' ? (v.text || (v.richText ? v.richText.map((t) => t.text).join('') : '') || (v.hyperlink ? String(v.hyperlink).replace(/^mailto:/i, '') : '') || (v.result !== undefined ? v.result : '')) : v);
    }
    rows.push(vals);
  });
  return rows.filter((r) => r.some((x) => clean(x)));
}

/** Associe les colonnes du fichier aux champs, d'après les titres. */
function mapColumns(header) {
  const h = header.map(norm); const used = new Set();
  const pick = (test) => { const i = h.findIndex((x, k) => !used.has(k) && test(x)); if (i >= 0) used.add(i); return i; };
  const country = pick((x) => /\b(pays|country)\b/.test(x));
  const email = pick((x) => /(e-?mail|courriel|mail)/.test(x));
  const phone = pick((x) => /(tel|phone|whatsapp|mobile|portable)/.test(x));
  const city = pick((x) => /\b(ville|city|localite)\b/.test(x));
  const currency = pick((x) => /\b(devise|currency|monnaie)\b/.test(x));
  const ref = pick((x) => /(code|ref|numero|n°|matricule|vendor|identifiant|id fournisseur)/.test(x));
  const name = pick((x) => /(nom|raison|name|denomination|libelle)/.test(x) || x === 'fournisseur' || x === 'supplier');
  const contact = email < 0 ? pick((x) => /contact/.test(x)) : -1;
  return { name, ref, country, email: email >= 0 ? email : contact, phone, city, currency };
}

/** Analyse le fichier et prépare chaque ligne : nouvelle, mise à jour, inchangée ou en erreur. */
async function analyse(req) {
  if (!req.file) throw httpError(400, 'Aucun fichier reçu.');
  const fn = (req.file.originalname || '').toLowerCase();
  let rows;
  if (fn.endsWith('.csv') || fn.endsWith('.txt') || /text\/csv/.test(req.file.mimetype)) rows = parseCsv(decodeText(req.file.buffer));
  else if (fn.endsWith('.xlsx') || fn.endsWith('.xlsm')) rows = await readXlsx(req.file.buffer);
  else if (fn.endsWith('.xls')) throw httpError(400, 'Le format .xls (Excel 97) n\'est pas pris en charge : dans Excel, « Enregistrer sous » au format .xlsx ou CSV.');
  else throw httpError(400, 'Format non reconnu : utilisez un fichier .xlsx ou .csv.');
  if (rows.length < 2) throw httpError(400, 'Le fichier est vide ou ne contient que la ligne de titres.');
  if (rows.length > 20001) throw httpError(400, 'Fichier trop volumineux : 20 000 lignes au maximum par import.');
  const cols = mapColumns(rows[0]);
  if (cols.name < 0) throw httpError(400, 'Colonne du nom introuvable. La première ligne doit contenir les titres, par exemple : Nom fournisseur ; Code fournisseur ; Pays ; E-mails contact. Téléchargez le modèle pour partir d\'une base correcte.');

  const existing = db.prepare('SELECT * FROM suppliers WHERE tenant_id = ?').all(TID(req));
  const byRef = new Map(existing.filter((s) => s.ref).map((s) => [norm(s.ref), s]));
  const byName = new Map(existing.map((s) => [norm(s.name), s]));
  const seen = new Set();
  const lines = [];
  rows.slice(1).forEach((r, k) => {
    const get = (i) => (i >= 0 ? clean(r[i]) : '');
    const line = k + 2;
    const name = get(cols.name); const ref = get(cols.ref);
    const em = splitEmails(get(cols.email));
    const item = { line, name, ref, country: get(cols.country), email: em.ok.join('; '), phone: get(cols.phone), city: get(cols.city), currency: get(cols.currency).toUpperCase(), status: 'new', note: '' };
    if (!name && !ref) return; // ligne vide
    if (!name) { item.status = 'error'; item.note = 'Nom manquant'; lines.push(item); return; }
    const key = ref ? 'r:' + norm(ref) : 'n:' + norm(name);
    if (seen.has(key)) { item.status = 'error'; item.note = 'Doublon dans le fichier'; lines.push(item); return; }
    seen.add(key);
    if (em.bad.length) item.note = `E-mail ignoré : ${em.bad.slice(0, 2).join(', ')}`;
    const match = (ref && byRef.get(norm(ref))) || byName.get(norm(name));
    if (match) {
      item.id = match.id;
      const changed = ['ref', 'country', 'email', 'phone', 'city', 'currency'].some((f) => item[f] && clean(item[f]) !== clean(match[f]))
        || (item.name && item.name !== match.name && ref && norm(ref) === norm(match.ref || ''));
      item.status = changed ? 'update' : 'same';
      if (item.ref && match.ref && norm(item.ref) !== norm(match.ref)) { item.status = 'error'; item.note = `Même nom qu'un fournisseur existant mais code différent (${match.ref})`; }
    }
    lines.push(item);
  });
  const count = (s) => lines.filter((l) => l.status === s).length;
  const mapped = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i >= 0 ? clean(rows[0][i]) : null]));
  return { lines, summary: { new: count('new'), update: count('update'), same: count('same'), error: count('error'), total: lines.length }, columns: mapped };
}

router.post('/suppliers/import', canEdit, upload.single('file'), wrapAsync(async (req, res) => {
  const a = await analyse(req);
  if ((req.body || {}).mode !== 'commit') {
    return res.json({ preview: true, ...a, sample: [...a.lines.filter((l) => l.status === 'error'), ...a.lines.filter((l) => l.status !== 'error')].slice(0, 100) });
  }
  const ins = db.prepare('INSERT INTO suppliers (tenant_id,ref,name,country,city,currency,email,phone,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const upd = db.prepare('UPDATE suppliers SET ref=COALESCE(?,ref), name=?, country=COALESCE(?,country), city=COALESCE(?,city), currency=COALESCE(?,currency), email=COALESCE(?,email), phone=COALESCE(?,phone), active=1, updated_at=? WHERE id=? AND tenant_id=?');
  const nz = (v) => (v ? v : null);
  db.transaction(() => {
    a.lines.forEach((l) => {
      if (l.status === 'new') ins.run(TID(req), nz(l.ref), l.name, nz(l.country), nz(l.city), nz(l.currency), nz(l.email), nz(l.phone), nowSql());
      else if (l.status === 'update') upd.run(nz(l.ref), l.name, nz(l.country), nz(l.city), nz(l.currency), nz(l.email), nz(l.phone), nowSql(), l.id, TID(req));
    });
  })();
  audit(req, 'suppliers_import', 'supplier', null, `${a.summary.new} ajoutés, ${a.summary.update} mis à jour, ${a.summary.error} rejetés`);
  res.json({ done: true, summary: a.summary, errors: a.lines.filter((l) => l.status === 'error').slice(0, 200) });
}));

module.exports = router;
module.exports._test = { parseCsv, mapColumns, splitEmails };
