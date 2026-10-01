'use strict';
const db = require('../db');
const { loadModel, isVisible, computeCalcs, computeMetrics, coerce } = require('./model');
const { jparse, nowSql, httpError, toNum } = require('./util');
const { currentStep, eligibleApprovers } = require('./workflow');

const CORE_COLS = ['currency', 'fx_rate', 'budget', 'historical', 'initial', 'final', 'budget_xof', 'historical_xof', 'initial_xof', 'final_xof', 'effort_xof', 'saving_budget_xof',
  'department', 'purchase_type', 'spend_nature', 'strategy', 'saving_type', 'pscs_code', 'segment_code', 'supplier_name', 'offers_count', 'conform_count', 'launch_date', 'end_date', 'pr_number', 'requester', 'derogation'];

function sanitize(model, input, { create } = {}) {
  const raw = (input && input.data) || {};
  const data = {};
  model.faeFields.forEach((f) => {
    if (f.type === 'calc') return;
    let v = raw[f.key];
    if ((v === undefined || v === '') && create && f.default_value) v = f.default_value;
    data[f.key] = coerce(f, v);
  });
  // efface les champs masqués par une condition
  model.faeFields.forEach((f) => { if (f.type !== 'calc' && !isVisible(f, data)) data[f.key] = coerce(f, ''); });

  const max = Math.min(Number(model.settings.max_offers) || 6, 12);
  const offersIn = Array.isArray(input && input.offers) ? input.offers.slice(0, max) : [];
  const offers = [];
  offersIn.forEach((o) => {
    const od = {};
    const src = (o && o.data) || {};
    model.offerFields.forEach((f) => { if (f.type !== 'calc') od[f.key] = coerce(f, src[f.key]); });
    const hasAny = Object.values(od).some((v) => v !== '' && v !== false);
    if (hasAny) offers.push({ data: od, retained: !!(o && o.retained) });
  });
  let seen = false;
  offers.forEach((o) => { if (o.retained && !seen) seen = true; else o.retained = false; });
  return { data, offers };
}

function persistOffers(model, faeId, tenantId, offers) {
  db.prepare('DELETE FROM offers WHERE fae_id = ?').run(faeId);
  const kSup = model.roleKey('offer', 'o_supplier'), kConf = model.roleKey('offer', 'o_conformity'), kAmt = model.roleKey('offer', 'o_amount'), kXof = model.roleKey('offer', 'o_amount_xof'), kDelay = model.roleKey('offer', 'o_delay');
  const findSup = db.prepare('SELECT ref FROM suppliers WHERE tenant_id = ? AND lower(name) = lower(?) LIMIT 1');
  offers.forEach((o, i) => {
    const name = kSup ? o.data[kSup] : null;
    const ref = name ? (findSup.get(tenantId, name) || {}).ref || null : null;
    db.prepare('INSERT INTO offers (fae_id,tenant_id,position,supplier_ref,supplier_name,conformity,amount,amount_xof,delay,retained,data) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(faeId, tenantId, i + 1, ref, name || null, kConf ? o.data[kConf] || null : null, kAmt ? toNum(o.data[kAmt]) : null, kXof ? toNum(o.data[kXof]) : null, kDelay ? o.data[kDelay] || null : null, o.retained ? 1 : 0, JSON.stringify(o.data));
  });
}

function nextNumber(tenantId, settings) {
  const year = new Date().getFullYear();
  const seq = (db.prepare('SELECT COALESCE(MAX(seq),0) m FROM fae WHERE tenant_id = ? AND year = ?').get(tenantId, year).m) + 1;
  return { year, seq, number: `${settings.number_prefix || 'FAE'}-${year}-${String(seq).padStart(4, '0')}` };
}

function applyMetricsSql(metrics) {
  const cols = CORE_COLS.filter((c) => c in metrics);
  return { cols, values: cols.map((c) => (metrics[c] === undefined ? null : metrics[c])) };
}

/** Enregistre (création ou mise à jour) une FAE en brouillon. */
function save({ tenantId, user, id, payload }) {
  const model = loadModel(tenantId);
  const { data: cleanData, offers: cleanOffers } = sanitize(model, payload, { create: !id });
  const calc = computeCalcs(model, cleanData, cleanOffers);
  const metrics = computeMetrics(model, calc.data, calc.offers);
  const { cols, values } = applyMetricsSql(metrics);
  const title = metrics.title || 'Sans objet';
  let faeId = id;
  db.transaction(() => {
    if (!id) {
      const n = nextNumber(tenantId, model.settings);
      const info = db.prepare(`INSERT INTO fae (tenant_id,year,seq,number,status,buyer_id,title,data,${cols.join(',')}) VALUES (?,?,?,?,'draft',?,?,?,${cols.map(() => '?').join(',')})`)
        .run(tenantId, n.year, n.seq, n.number, user.id, title, JSON.stringify(calc.data), ...values);
      faeId = info.lastInsertRowid;
      db.prepare('INSERT INTO fae_events (fae_id,tenant_id,user_id,user_name,type,message) VALUES (?,?,?,?,?,?)').run(faeId, tenantId, user.id, user.name, 'created', `FAE créée (${n.number})`);
    } else {
      db.prepare(`UPDATE fae SET title=?, data=?, updated_at=?, ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`)
        .run(title, JSON.stringify(calc.data), nowSql(), ...values, id);
    }
    persistOffers(model, faeId, tenantId, calc.offers);
  })();
  return faeId;
}

function getRow(id, tenantId) {
  return db.prepare('SELECT f.*, u.name AS buyer_name, u.email AS buyer_email FROM fae f JOIN users u ON u.id = f.buyer_id WHERE f.id = ? AND f.tenant_id = ?').get(id, tenantId);
}

function canView(user, row, settings) {
  if (!row || row.tenant_id !== user.tenant_id) return false;
  if (user.role !== 'buyer') return true;
  return row.buyer_id === user.id || !!settings.buyers_see_all;
}

function serialize(row, model, { full = false } = {}) {
  const out = {
    id: row.id, number: row.number, status: row.status, title: row.title, buyer_id: row.buyer_id, buyer_name: row.buyer_name,
    currency: row.currency, budget: row.budget, historical: row.historical, initial: row.initial, final: row.final,
    budget_xof: row.budget_xof, historical_xof: row.historical_xof, initial_xof: row.initial_xof, final_xof: row.final_xof,
    effort_xof: row.effort_xof, saving_budget_xof: row.saving_budget_xof,
    department: row.department, purchase_type: row.purchase_type, spend_nature: row.spend_nature, strategy: row.strategy,
    supplier_name: row.supplier_name, offers_count: row.offers_count, conform_count: row.conform_count, pr_number: row.pr_number, requester: row.requester,
    pscs_code: row.pscs_code, segment_code: row.segment_code, launch_date: row.launch_date, end_date: row.end_date,
    current_step: row.current_step, cycle: row.cycle, created_at: row.created_at, updated_at: row.updated_at, submitted_at: row.submitted_at, validated_at: row.validated_at,
    saving_budget_pct: row.budget_xof ? (row.saving_budget_xof ?? 0) / row.budget_xof : null,
    effort_pct: (row.effort_xof != null && row.final_xof != null && (row.effort_xof + row.final_xof) > 0) ? row.effort_xof / (row.effort_xof + row.final_xof) : null
  };
  if (!full) return out;
  out.data = jparse(row.data, {});
  out.offers = db.prepare('SELECT * FROM offers WHERE fae_id = ? ORDER BY position').all(row.id).map((o) => ({ id: o.id, retained: !!o.retained, data: jparse(o.data, {}) }));
  out.steps = db.prepare('SELECT * FROM fae_steps WHERE fae_id = ? ORDER BY cycle, position').all(row.id);
  out.events = db.prepare('SELECT * FROM fae_events WHERE fae_id = ? ORDER BY id').all(row.id).map((e) => ({ ...e, meta: jparse(e.meta, null) }));
  out.attachments = db.prepare('SELECT id, filename, size, mime, created_at, uploaded_by FROM attachments WHERE fae_id = ? ORDER BY id').all(row.id);
  const cur = row.status === 'in_review' ? currentStep(row) : null;
  out.pending_approvers = cur ? eligibleApprovers(cur, row).map((u) => ({ id: u.id, name: u.name, role: u.role })) : [];
  out.current_step_id = cur ? cur.id : null;
  return out;
}

const SORTS = { created: 'f.created_at', number: 'f.seq', amount: 'f.final_xof', updated: 'f.updated_at', validated: 'f.validated_at', supplier: 'f.supplier_name' };

function buildWhere(user, settings, q) {
  const w = ['f.tenant_id = @tenant']; const p = { tenant: user.tenant_id };
  if (user.role === 'buyer' && !settings.buyers_see_all) { w.push('f.buyer_id = @me'); p.me = user.id; }
  if (q.mine === '1' || q.mine === 'true') { w.push('f.buyer_id = @me2'); p.me2 = user.id; }
  if (q.q) { w.push("(f.number LIKE @q OR f.title LIKE @q OR f.supplier_name LIKE @q OR f.pr_number LIKE @q OR f.requester LIKE @q)"); p.q = `%${String(q.q).trim()}%`; }
  const multi = (col, key) => { const v = q[key]; if (v === undefined || v === '') return; const arr = String(v).split(',').filter(Boolean); if (!arr.length) return; w.push(`${col} IN (${arr.map((_, i) => `@${key}${i}`).join(',')})`); arr.forEach((x, i) => { p[key + i] = x; }); };
  multi('f.status', 'status'); multi('f.buyer_id', 'buyer_id'); multi('f.department', 'department'); multi('f.purchase_type', 'purchase_type');
  multi('f.strategy', 'strategy'); multi('f.spend_nature', 'spend_nature'); multi('f.segment_code', 'segment_code');
  if (q.supplier) { w.push('f.supplier_name LIKE @sup'); p.sup = `%${q.supplier}%`; }
  const basisCol = { created: 'f.created_at', validated: 'f.validated_at', launch: 'f.launch_date', submitted: 'f.submitted_at' }[q.basis] || 'f.created_at';
  if (q.from) { w.push(`date(${basisCol}) >= date(@from)`); p.from = q.from; }
  if (q.to) { w.push(`date(${basisCol}) <= date(@to)`); p.to = q.to; }
  if (q.min_amount) { w.push('f.final_xof >= @minA'); p.minA = Number(q.min_amount); }
  if (q.max_amount) { w.push('f.final_xof <= @maxA'); p.maxA = Number(q.max_amount); }
  return { where: w.join(' AND '), params: p };
}

function list(user, settings, q) {
  const { where, params } = buildWhere(user, settings, q);
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 25));
  const sort = SORTS[q.sort] || 'f.created_at';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const total = db.prepare(`SELECT COUNT(*) c FROM fae f WHERE ${where}`).get(params).c;
  const rows = db.prepare(`SELECT f.*, u.name AS buyer_name, (SELECT name FROM fae_steps s WHERE s.fae_id=f.id AND s.cycle=f.cycle AND s.status='pending' LIMIT 1) AS step_name
    FROM fae f JOIN users u ON u.id=f.buyer_id WHERE ${where} ORDER BY ${sort} ${dir}, f.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(params);
  return { total, page, limit, rows: rows.map((r) => ({ ...serialize(r, null), step_name: r.step_name })) };
}

module.exports = { save, getRow, canView, serialize, list, buildWhere, sanitize, CORE_COLS };
