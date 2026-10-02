'use strict';
/* Indicateurs achats : KPIs, séries pour graphiques, alertes, suivi budgétaire. */
const db = require('../db');
const { buildWhere } = require('./fae-service');
const { sharedView } = require('./util');

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const days = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 86400e3 : null);
const ts = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z') : null);

function groupBy(rows, keyFn) { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); if (k === null || k === undefined || k === '') return; (m.get(k) || m.set(k, []).get(k)).push(r); }); return m; }

function dashboard(user, settings, q) {
  const statuses = q.scope === 'active' ? 'approved,in_review' : 'approved';
  const { where, params } = buildWhere(user, settings, { ...q, status: statuses });
  const rows = db.prepare(`SELECT f.*, u.name AS buyer_name FROM fae f JOIN users u ON u.id = f.buyer_id WHERE ${where} ORDER BY f.created_at`).all(params);
  const minOffers = ((settings.controls || {}).min_offers) || 3;

  // pipeline (tous statuts, même périmètre hors filtre statut)
  const pw = buildWhere(user, settings, { ...q, status: '' });
  const pipeRows = db.prepare(`SELECT f.status, COUNT(*) c, COALESCE(SUM(f.final_xof),0) amt FROM fae f WHERE ${pw.where} GROUP BY f.status`).all(pw.params);
  const pipeline = {}; pipeRows.forEach((r) => { pipeline[r.status] = { count: r.c, amount: r.amt }; });

  const spend = sum(rows, 'final_xof');
  const withEffort = rows.filter((r) => r.effort_xof != null && r.final_xof != null);
  const effort = sum(withEffort, 'effort_xof');
  const baseline = withEffort.reduce((s, r) => s + r.final_xof + r.effort_xof, 0);
  const withSb = rows.filter((r) => r.saving_budget_xof != null && r.budget_xof);
  const savingBudget = sum(withSb, 'saving_budget_xof');
  const budgetBase = sum(withSb, 'budget_xof');
  const consult = rows.map((r) => days(r.launch_date, r.end_date)).filter((d) => d !== null && d >= 0);
  const valid = rows.map((r) => (r.submitted_at && r.validated_at ? (ts(r.validated_at) - ts(r.submitted_at)) / 3600e3 : null)).filter((d) => d !== null && d >= 0);
  const cycle = rows.map((r) => (r.validated_at ? (ts(r.validated_at) - ts(r.created_at)) / 86400e3 : null)).filter((d) => d !== null && d >= 0);
  const totalOffers = sum(rows, 'offers_count');

  const kpis = {
    count: rows.length,
    spend_xof: spend,
    avg_amount_xof: rows.length ? spend / rows.length : null,
    effort_xof: effort,
    effort_pct: baseline ? effort / baseline : null,
    saving_budget_xof: savingBudget,
    saving_budget_pct: budgetBase ? savingBudget / budgetBase : null,
    budget_xof: budgetBase,
    competition_rate: rows.length ? rows.filter((r) => r.offers_count >= minOffers).length / rows.length : null,
    single_source_rate: rows.length ? rows.filter((r) => r.offers_count <= 1).length / rows.length : null,
    avg_offers: rows.length ? totalOffers / rows.length : null,
    conform_rate: totalOffers ? sum(rows, 'conform_count') / totalOffers : null,
    derogation_rate: rows.length ? rows.filter((r) => String(r.derogation || '').toUpperCase() === 'OUI').length / rows.length : null,
    avg_consultation_days: avg(consult),
    avg_validation_hours: avg(valid),
    avg_cycle_days: avg(cycle),
    over_budget_count: rows.filter((r) => r.final_xof != null && r.budget_xof != null && r.final_xof > r.budget_xof).length,
    min_offers: minOffers
  };

  // évolution mensuelle
  const byMonth = groupBy(rows, (r) => r.created_at.slice(0, 7));
  const monthly = [...byMonth.entries()].sort().map(([m, rs]) => ({ month: m, spend: sum(rs, 'final_xof'), effort: sum(rs, 'effort_xof'), saving_budget: sum(rs, 'saving_budget_xof'), count: rs.length }));

  // par domaine d'achat (segment PSCS)
  const segNames = {}; db.prepare("SELECT code, COALESCE(NULLIF(long_name,''), short_name) n FROM pscs WHERE tenant_id = ? AND level = 'Segment'").all(user.tenant_id).forEach((r) => { segNames[r.code] = r.n; });
  const bySegment = [...groupBy(rows, (r) => r.segment_code).entries()].map(([k, rs]) => ({ code: k, name: segNames[k] || `Segment ${k}`, spend: sum(rs, 'final_xof'), effort: sum(rs, 'effort_xof'), count: rs.length })).sort((a, b) => b.spend - a.spend);

  // budgets annuels par département
  const year = Number(String(q.to || new Date().toISOString()).slice(0, 4)) || new Date().getFullYear();
  const budgets = {}; db.prepare('SELECT department, amount_xof FROM budgets WHERE tenant_id = ? AND year = ?').all(user.tenant_id, year).forEach((b) => { budgets[b.department] = b.amount_xof; });
  const yearRows = db.prepare(`SELECT f.department, COALESCE(SUM(f.final_xof),0) s FROM fae f WHERE f.tenant_id = ? AND f.status IN ('approved','in_review') AND strftime('%Y', f.created_at) = ? ${user.role === 'buyer' && !sharedView(settings) ? 'AND f.buyer_id = ' + Number(user.id) : ''} GROUP BY f.department`).all(user.tenant_id, String(year));
  const consumed = {}; yearRows.forEach((r) => { if (r.department) consumed[r.department] = r.s; });
  const byDept = [...groupBy(rows, (r) => r.department).entries()].map(([k, rs]) => ({ department: k, spend: sum(rs, 'final_xof'), effort: sum(rs, 'effort_xof'), count: rs.length })).sort((a, b) => b.spend - a.spend);
  const deptBudget = [...new Set([...Object.keys(budgets), ...Object.keys(consumed)])].map((d) => ({ department: d, budget: budgets[d] || 0, consumed: consumed[d] || 0 })).sort((a, b) => b.consumed - a.consumed);

  // fournisseurs
  const supRows = [...groupBy(rows, (r) => r.supplier_name).entries()].map(([k, rs]) => ({ supplier: k, spend: sum(rs, 'final_xof'), count: rs.length, effort: sum(rs, 'effort_xof') })).sort((a, b) => b.spend - a.spend);
  const top5 = supRows.slice(0, 5).reduce((s, r) => s + r.spend, 0);
  const suppliers = { top: supRows.slice(0, 10), total_suppliers: supRows.length, top5_share: spend ? top5 / spend : null };
  // taux de sélection : fournisseurs consultés vs retenus
  const consulted = db.prepare(`SELECT o.supplier_name, COUNT(*) n, SUM(o.retained) won FROM offers o JOIN fae f ON f.id = o.fae_id WHERE ${where.replace(/f\.tenant_id = @tenant/, 'f.tenant_id = @tenant')} AND o.supplier_name IS NOT NULL GROUP BY o.supplier_name ORDER BY n DESC LIMIT 10`).all(params);

  // acheteurs
  const byBuyer = [...groupBy(rows, (r) => r.buyer_name).entries()].map(([k, rs]) => {
    const we = rs.filter((r) => r.effort_xof != null && r.final_xof != null); const base = we.reduce((s, r) => s + r.final_xof + r.effort_xof, 0);
    return { buyer: k, count: rs.length, spend: sum(rs, 'final_xof'), effort: sum(we, 'effort_xof'), effort_pct: base ? sum(we, 'effort_xof') / base : null, avg_days: avg(rs.map((r) => (r.validated_at ? (ts(r.validated_at) - ts(r.created_at)) / 86400e3 : null)).filter((x) => x !== null)) };
  }).sort((a, b) => b.effort - a.effort);

  const dist = (fn) => [...groupBy(rows, fn).entries()].map(([k, rs]) => ({ name: k, spend: sum(rs, 'final_xof'), count: rs.length, effort: sum(rs, 'effort_xof') })).sort((a, b) => b.spend - a.spend);
  const byType = dist((r) => r.purchase_type), byStrategy = dist((r) => r.strategy), byNature = dist((r) => r.spend_nature), bySavingType = dist((r) => r.saving_type);

  // workflow : durée moyenne par étape + en attente
  const stepStats = db.prepare(`SELECT s.name, COUNT(*) n, AVG((julianday(s.acted_at) - julianday(s.activated_at)) * 24) hrs
    FROM fae_steps s JOIN fae f ON f.id = s.fae_id WHERE ${where} AND s.status='approved' AND s.acted_at IS NOT NULL AND s.activated_at IS NOT NULL GROUP BY s.name ORDER BY MIN(s.position)`)
    .all(params).map((r) => ({ step: r.name, count: r.n, hours: r.hrs }));
  const pw2 = buildWhere(user, settings, { ...q, status: 'in_review', from: '', to: '' });
  const pending = db.prepare(`SELECT s.name step, COUNT(*) n, SUM(CASE WHEN s.due_at < datetime('now') THEN 1 ELSE 0 END) overdue
    FROM fae_steps s JOIN fae f ON f.id = s.fae_id AND s.cycle = f.cycle WHERE ${pw2.where} AND s.status='pending' GROUP BY s.name`).all(pw2.params);

  // alertes
  const alerts = [];
  rows.filter((r) => r.final_xof != null && r.budget_xof != null && r.final_xof > r.budget_xof).slice(-5).forEach((r) => alerts.push({ level: 'warn', type: 'over_budget', fae_id: r.id, number: r.number, text: `${r.number} dépasse son budget de ${Math.round(r.final_xof - r.budget_xof).toLocaleString('fr-FR')} CFA` }));
  rows.filter((r) => r.offers_count <= 1).slice(-4).forEach((r) => alerts.push({ level: 'info', type: 'single', fae_id: r.id, number: r.number, text: `${r.number} : un seul fournisseur consulté` }));
  db.prepare(`SELECT f.id, f.number, s.name step, s.due_at FROM fae_steps s JOIN fae f ON f.id=s.fae_id AND s.cycle=f.cycle WHERE ${pw2.where} AND s.status='pending' AND s.due_at < datetime('now') ORDER BY s.due_at LIMIT 5`).all(pw2.params)
    .forEach((r) => alerts.push({ level: 'danger', type: 'overdue', fae_id: r.id, number: r.number, text: `${r.number} : validation en retard (« ${r.step} »)` }));

  return { kpis, pipeline, monthly, bySegment, byDept, deptBudget, budget_year: year, suppliers, consulted, byBuyer, byType, byStrategy, byNature, bySavingType, workflow: { steps: stepStats, pending }, alerts };
}

module.exports = { dashboard };
