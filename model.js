'use strict';
/* Modèle de fiche d'un client : chargement des champs, calculs, indicateurs, contrôles. */
const db = require('../db');
const Calc = require('../../shared/calc');
const { jparse, toNum } = require('./util');

function loadModel(tenantId) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  const sections = db.prepare('SELECT * FROM sections WHERE tenant_id = ? AND active = 1 ORDER BY scope, sort, id').all(tenantId);
  const allFields = db.prepare('SELECT * FROM fields WHERE tenant_id = ? ORDER BY scope, sort, id').all(tenantId).map((f) => ({
    ...f,
    options: f.type === 'select' ? jparse(f.options, null) : jparse(f.options, {}),
    visible_if: jparse(f.visible_if, null)
  }));
  const listRows = db.prepare('SELECT * FROM ref_items WHERE tenant_id = ? AND active = 1 ORDER BY list_key, sort, id').all(tenantId);
  const lists = {};
  listRows.forEach((r) => { (lists[r.list_key] = lists[r.list_key] || []).push({ value: r.value, label: r.label || r.value, meta: jparse(r.meta, {}) }); });
  const settings = { ...jparse(tenant.settings, {}) };
  const model = Calc.makeModel({ fields: allFields, lists, sections, settings });
  model.tenant = tenant;
  model.allFields = allFields;
  return model;
}

function isBlank(v) { return v === '' || v === null || v === undefined; }

const { isVisible, currencyRate, effectiveFx, computeCalcs } = Calc;

function coerce(field, v) {
  if (v === undefined || v === null) return '';
  switch (field.type) {
    case 'number': case 'money': case 'percent': { const n = toNum(v); return n === null ? '' : n; }
    case 'date': { const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
    case 'checkbox': return v === true || v === 'true' || v === 1 || v === '1';
    case 'calc': return v;
    default: return String(v).slice(0, 4000);
  }
}

function numOrNull(v) { const n = toNum(v); return n === null ? null : n; }

/** Indicateurs dénormalisés (utilisés par les tableaux de bord et les extractions). */
function computeMetrics(model, data, offers) {
  const fx = effectiveFx(model, data);
  const currency = model.roleValue(data, 'currency') || 'CFA';
  const budget = numOrNull(model.roleValue(data, 'budget'));
  const historical = numOrNull(model.roleValue(data, 'historical'));
  const final = numOrNull(model.roleValue(data, 'amount_final'));
  const retained = offers.find((o) => o.retained) || null;
  const initialField = numOrNull(model.roleValue(data, 'amount_initial'));
  const oAmountKey = model.roleKey('offer', 'o_amount');
  const initial = initialField !== null ? initialField : (retained && oAmountKey ? numOrNull((retained.data || {})[oAmountKey]) : null);
  const conv = (v) => (v === null || fx == null ? null : Math.round(v * fx * 100) / 100);
  const baseline = historical !== null && historical > 0 ? historical : initial;
  const effort = final !== null && baseline !== null ? baseline - final : null;
  const savingBudget = final !== null && budget !== null ? budget - final : null;

  const pscs = String(model.roleValue(data, 'pscs') || '');
  const oSupKey = model.roleKey('offer', 'o_supplier');
  const oConfKey = model.roleKey('offer', 'o_conformity');
  const filled = offers.filter((o) => oSupKey && !isBlank((o.data || {})[oSupKey]));
  const conformCount = filled.filter((o) => oConfKey && String((o.data || {})[oConfKey] || '').trim().toUpperCase() === 'CONFORME').length;

  return {
    currency, fx_rate: fx,
    budget, historical, initial, final,
    budget_xof: conv(budget), historical_xof: conv(historical), initial_xof: conv(initial), final_xof: conv(final),
    effort_xof: conv(effort), saving_budget_xof: conv(savingBudget),
    department: model.roleValue(data, 'department') || null,
    purchase_type: model.roleValue(data, 'purchase_type') || null,
    spend_nature: model.roleValue(data, 'spend_nature') || null,
    strategy: model.roleValue(data, 'strategy') || null,
    saving_type: model.roleValue(data, 'saving_type') || null,
    derogation: model.roleValue(data, 'derogation') || null,
    pscs_code: pscs || null,
    segment_code: pscs ? pscs.slice(0, 2) : null,
    supplier_name: retained && oSupKey ? (retained.data || {})[oSupKey] || null : null,
    offers_count: filled.length,
    conform_count: conformCount,
    launch_date: model.roleValue(data, 'launch_date') || null,
    end_date: model.roleValue(data, 'end_date') || null,
    pr_number: model.roleValue(data, 'pr_number') || null,
    requester: model.roleValue(data, 'requester') || null,
    title: model.roleValue(data, 'title') || null
  };
}

/** Contrôles de conformité du process d'achat. level: block | warn */
function runChecks(model, data, offers, metrics, mode = 'submit') {
  const issues = [];
  const cs = { min_offers: 3, min_offers_mode: 'warn', block_nonconform: true, over_budget_mode: 'warn', require_justification_not_lowest: true, ...(model.settings.controls || {}) };
  const add = (level, code, message, field) => issues.push({ level, code, message, field });

  // 1. champs obligatoires
  model.faeFields.forEach((f) => {
    if (!f.required || f.type === 'calc' || !isVisible(f, data)) return;
    if (isBlank(data[f.key])) add('block', 'required', `Champ obligatoire : ${f.label}`, f.key);
  });

  const oSupKey = model.roleKey('offer', 'o_supplier');
  const oConfKey = model.roleKey('offer', 'o_conformity');
  const oAmtXofKey = model.roleKey('offer', 'o_amount_xof');
  const filled = offers.filter((o) => oSupKey && !isBlank((o.data || {})[oSupKey]));

  if (!filled.length) add('block', 'no_offer', 'Ajoutez au moins un fournisseur consulté.');
  filled.forEach((o, i) => {
    model.offerFields.forEach((f) => {
      if (f.required && f.type !== 'calc' && isBlank((o.data || {})[f.key])) add('block', 'offer_required', `Fournisseur n°${i + 1} : « ${f.label} » est obligatoire.`);
    });
  });
  // doublons
  const names = filled.map((o) => String(o.data[oSupKey]).trim().toLowerCase());
  if (new Set(names).size !== names.length) add('block', 'dup_supplier', 'Un même fournisseur apparaît deux fois dans la consultation.');

  const retained = offers.find((o) => o.retained);
  if (filled.length && !retained) add('block', 'no_retained', 'Désignez le fournisseur retenu.');

  if (retained && oConfKey) {
    const c = String((retained.data || {})[oConfKey] || '').trim().toUpperCase();
    if (c !== 'CONFORME') add(cs.block_nonconform ? 'block' : 'warn', 'retained_nonconform', 'Le fournisseur retenu n\'est pas déclaré techniquement conforme.');
  }

  // 2. mise en concurrence
  if (cs.min_offers_mode !== 'off' && filled.length && filled.length < cs.min_offers) {
    const derog = String(data[model.roleKey('fae', 'derogation')] || '').toUpperCase();
    if (derog !== 'OUI') add(cs.min_offers_mode === 'block' ? 'block' : 'warn', 'few_offers', `Seulement ${filled.length} fournisseur(s) consulté(s) (minimum recommandé : ${cs.min_offers}). Joignez une fiche de dérogation ou élargissez la consultation.`);
  }

  // 3. budget
  if (cs.over_budget_mode !== 'off' && metrics.final_xof != null && metrics.budget_xof != null && metrics.final_xof > metrics.budget_xof) {
    add(cs.over_budget_mode === 'block' ? 'block' : 'warn', 'over_budget', 'Le montant final dépasse le budget alloué.');
  }
  if (metrics.final != null && metrics.initial != null && metrics.final > metrics.initial) add('warn', 'final_gt_initial', 'Le montant final est supérieur à l\'offre initiale du fournisseur retenu.');

  // 4. devise
  if (metrics.currency && metrics.fx_rate == null) add('block', 'fx_missing', `Renseignez le taux de conversion ${metrics.currency} → CFA.`, model.roleKey('fae', 'fx_rate'));

  // 5. dates
  if (metrics.launch_date && metrics.end_date && metrics.end_date < metrics.launch_date) add('block', 'dates', 'La date de fin de consultation précède la date de lancement.');

  // 6. justification si pas le moins-disant conforme
  if (cs.require_justification_not_lowest && retained && oAmtXofKey && oConfKey) {
    const conform = filled.filter((o) => String(o.data[oConfKey] || '').trim().toUpperCase() === 'CONFORME' && toNum(o.data[oAmtXofKey]) !== null);
    if (conform.length > 1) {
      const lowest = conform.reduce((m, o) => (toNum(o.data[oAmtXofKey]) < toNum(m.data[oAmtXofKey]) ? o : m));
      if (lowest !== retained && toNum(retained.data[oAmtXofKey]) > toNum(lowest.data[oAmtXofKey])) {
        const crit = String(data[model.roleKey('fae', 'criteria')] || '').trim();
        if (crit.length < 25) add('block', 'not_lowest', 'Le fournisseur retenu n\'est pas le moins-disant conforme : détaillez les critères de choix (25 caractères minimum).', model.roleKey('fae', 'criteria'));
        else add('warn', 'not_lowest', 'Le fournisseur retenu n\'est pas le moins-disant conforme (justifié dans les critères de choix).');
      }
    }
  }
  return mode === 'submit' ? issues : issues.filter((i) => i.level === 'warn');
}

module.exports = { loadModel, isVisible, computeCalcs, computeMetrics, runChecks, coerce, effectiveFx, currencyRate, isBlank };
