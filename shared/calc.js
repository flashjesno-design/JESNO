/* Calculs de la fiche partagés serveur / navigateur : visibilité conditionnelle, taux de change, champs calculés. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./formula'));
  else root.FaeCalc = factory(root.Formula);
})(typeof self !== 'undefined' ? self : this, function (Formula) {
  'use strict';

  const isBlank = (v) => v === '' || v === null || v === undefined;
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /** Enrichit { fields, lists, sections, settings } avec les accès par rôle analytique. */
  function makeModel(m) {
    const fields = (m.fields || []).filter((f) => f.active !== 0 && f.active !== false);
    return Object.assign({}, m, {
      fields,
      faeFields: fields.filter((f) => f.scope === 'fae'),
      offerFields: fields.filter((f) => f.scope === 'offer'),
      roleKey(scope, role) { const f = fields.find((x) => x.scope === scope && x.role === role); return f ? f.key : null; },
      roleValue(data, role, scope) { const k = this.roleKey(scope || 'fae', role); return k ? data[k] : undefined; }
    });
  }

  function isVisible(field, data) {
    const c = field.visible_if;
    if (!c || !c.field) return true;
    const v = data[c.field], cv = c.value;
    const norm = (x) => String(x === undefined || x === null ? '' : x).trim().toLowerCase();
    switch (c.op) {
      case 'eq': return norm(v) === norm(cv);
      case 'ne': return norm(v) !== norm(cv);
      case 'empty': return isBlank(v);
      case 'notempty': return !isBlank(v);
      case 'gt': return (toNum(v) || 0) > (toNum(cv) || 0);
      case 'lt': return (toNum(v) || 0) < (toNum(cv) || 0);
      default: return true;
    }
  }

  function currencyRate(model, currency) {
    if (!currency) return 1;
    const c = String(currency).trim().toUpperCase();
    if (c === 'CFA' || c === 'XOF' || c === 'FCFA') return 1;
    const it = ((model.lists || {}).currency || []).find((i) => String(i.value).toUpperCase() === c);
    return it && it.meta && it.meta.rate ? Number(it.meta.rate) : null;
  }

  function effectiveFx(model, data) {
    const currency = model.roleValue(data, 'currency');
    const own = toNum(model.roleValue(data, 'fx_rate'));
    const c = String(currency || 'CFA').trim().toUpperCase();
    if (c === 'CFA' || c === 'XOF' || c === 'FCFA') return 1;
    if (own && own > 0) return own;
    return currencyRate(model, currency);
  }

  /** Évalue tous les champs calculés. Entrées non modifiées ; retourne { data, offers, fx }. */
  function computeCalcs(model, dataIn, offersIn) {
    const data = Object.assign({}, dataIn);
    const offers = (offersIn || []).map((o) => Object.assign({}, o));
    const fx = effectiveFx(model, data);
    const calcFae = model.faeFields.filter((f) => f.type === 'calc' && f.formula);
    const calcOff = model.offerFields.filter((f) => f.type === 'calc' && f.formula);
    const hdrGet = (name) => {
      if (name === 'FX') { if (fx == null) throw new Error('Taux manquant'); return fx; }
      return data[name];
    };
    const offerStat = (kind, key) => {
      if (kind === 'count') return offers.filter((o) => Object.values(o.data || {}).some((v) => !isBlank(v) && v !== false)).length;
      if (kind === 'retained') { const r = offers.find((o) => o.retained); return r ? (r.data || {})[key] : ''; }
      const vals = offers.map((o) => toNum((o.data || {})[key])).filter((n) => n !== null);
      if (!vals.length) return '';
      if (kind === 'min') return Math.min.apply(null, vals);
      if (kind === 'max') return Math.max.apply(null, vals);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    for (let pass = 0; pass < 4; pass++) {
      offers.forEach((o) => {
        o.data = Object.assign({}, o.data || {});
        calcOff.forEach((f) => {
          const r = Formula.evaluate(f.formula, { get: (n) => (n.charAt(0) === '$' ? hdrGet(n.slice(1)) : o.data[n]) });
          o.data[f.key] = r.ok ? r.value : '';
        });
      });
      calcFae.forEach((f) => {
        const r = Formula.evaluate(f.formula, { get: hdrGet, offers: offerStat });
        data[f.key] = r.ok ? r.value : '';
      });
    }
    return { data, offers, fx };
  }

  return { makeModel, isVisible, currencyRate, effectiveFx, computeCalcs, toNum, isBlank };
});
