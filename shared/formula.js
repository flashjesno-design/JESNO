/* Moteur de formules sécurisé (sans eval) — partagé serveur / navigateur.
   Syntaxe proche d'Excel : {champ}, {$champ_de_la_fiche} (dans une offre), + - * / ^ & = <> < > <= >=,
   IF, IFERROR, AND, OR, NOT, ISBLANK, MIN, MAX, ABS, ROUND, SUM, AVG, TEXT-free.
   Fonctions offres : RETAINED("cle"), MINOFFER("cle"), MAXOFFER("cle"), AVGOFFER("cle"), COUNTOFFERS().  */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Formula = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{') {
        const j = src.indexOf('}', i);
        if (j < 0) throw new Error('Accolade { non fermée');
        t.push({ k: 'ref', v: src.slice(i + 1, j).trim() }); i = j + 1; continue;
      }
      if (c === '"') {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== '"') s += src[j++];
        if (j >= src.length) throw new Error('Guillemet non fermé');
        t.push({ k: 'str', v: s }); i = j + 1; continue;
      }
      if (/[0-9.]/.test(c)) {
        let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
        t.push({ k: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        t.push({ k: 'id', v: src.slice(i, j).toUpperCase() }); i = j; continue;
      }
      const two = src.substr(i, 2);
      if (['<>', '<=', '>='].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>(),'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
      throw new Error('Caractère inattendu : ' + c);
    }
    return t;
  }

  function parse(src) {
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p];
    const eat = (v) => { const t = toks[p]; if (!t || (v && t.v !== v)) throw new Error('Syntaxe : ' + (v || 'expression') + ' attendu'); p++; return t; };
    const isOp = (v) => toks[p] && toks[p].k === 'op' && toks[p].v === v;

    function cmp() {
      let l = concat();
      while (peek() && peek().k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = toks[p++].v; l = { t: 'bin', op, l, r: concat() };
      }
      return l;
    }
    function concat() { let l = add(); while (isOp('&')) { p++; l = { t: 'bin', op: '&', l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: mul() }; } return l; }
    function mul() { let l = pow(); while (isOp('*') || isOp('/')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: pow() }; } return l; }
    function pow() { let l = unary(); while (isOp('^')) { p++; l = { t: 'bin', op: '^', l, r: unary() }; } return l; }
    function unary() {
      if (isOp('-')) { p++; return { t: 'neg', e: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      return primary();
    }
    function primary() {
      const t = toks[p];
      if (!t) throw new Error('Formule incomplète');
      if (t.k === 'num') { p++; return { t: 'lit', v: t.v }; }
      if (t.k === 'str') { p++; return { t: 'lit', v: t.v }; }
      if (t.k === 'ref') { p++; return { t: 'ref', name: t.v }; }
      if (t.k === 'id') {
        p++;
        if (t.v === 'TRUE') return { t: 'lit', v: true };
        if (t.v === 'FALSE') return { t: 'lit', v: false };
        eat('(');
        const args = [];
        if (!isOp(')')) { args.push(cmp()); while (isOp(',')) { p++; args.push(cmp()); } }
        eat(')');
        return { t: 'fn', name: t.v, args };
      }
      if (isOp('(')) { p++; const e = cmp(); eat(')'); return e; }
      throw new Error('Symbole inattendu');
    }
    const ast = cmp();
    if (p < toks.length) throw new Error('Symbole inattendu après la fin de la formule');
    return ast;
  }

  const isBlank = (v) => v === '' || v === null || v === undefined;
  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isBlank(v)) return 0;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(n)) throw new Error('#VALEUR');
    return n;
  }
  const truthy = (v) => (typeof v === 'string' ? v !== '' : !!v);

  function run(node, ctx) {
    switch (node.t) {
      case 'lit': return node.v;
      case 'ref': {
        const v = ctx.get ? ctx.get(node.name) : undefined;
        return v === undefined || v === null ? '' : v;
      }
      case 'neg': return -num(run(node.e, ctx));
      case 'bin': {
        const a = run(node.l, ctx), b = run(node.r, ctx);
        switch (node.op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': { const d = num(b); if (d === 0) throw new Error('#DIV/0'); return num(a) / d; }
          case '^': return Math.pow(num(a), num(b));
          case '&': return String(a) + String(b);
          case '=': case '<>': {
            let eq;
            if (isBlank(a) && isBlank(b)) eq = true;
            else if (typeof a === 'string' && typeof b === 'string') eq = a.trim().toLowerCase() === b.trim().toLowerCase();
            else if (!isBlank(a) && !isBlank(b) && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) eq = Number(a) === Number(b);
            else eq = String(a) === String(b);
            return node.op === '=' ? eq : !eq;
          }
          default: {
            const x = (typeof a === 'string' && Number.isNaN(Number(a))) ? a : num(a);
            const y = (typeof b === 'string' && Number.isNaN(Number(b))) ? b : num(b);
            if (node.op === '<') return x < y;
            if (node.op === '>') return x > y;
            if (node.op === '<=') return x <= y;
            return x >= y;
          }
        }
      }
      case 'fn': return callFn(node, ctx);
    }
    throw new Error('Nœud inconnu');
  }

  function callFn(node, ctx) {
    const a = node.args, n = node.name;
    const ev = (i) => run(a[i], ctx);
    switch (n) {
      case 'IF': return truthy(ev(0)) ? (a[1] ? ev(1) : true) : (a[2] ? ev(2) : false);
      case 'IFERROR': try { const v = ev(0); return v; } catch (e) { return a[1] ? ev(1) : ''; }
      case 'AND': return a.every((_, i) => truthy(ev(i)));
      case 'OR': return a.some((_, i) => truthy(ev(i)));
      case 'NOT': return !truthy(ev(0));
      case 'ISBLANK': return isBlank(ev(0));
      case 'ABS': return Math.abs(num(ev(0)));
      case 'ROUND': { const d = a[1] ? num(ev(1)) : 0; const f = Math.pow(10, d); return Math.round(num(ev(0)) * f) / f; }
      case 'MIN': return Math.min(...a.map((_, i) => num(ev(i))));
      case 'MAX': return Math.max(...a.map((_, i) => num(ev(i))));
      case 'SUM': return a.reduce((s, _, i) => s + num(ev(i)), 0);
      case 'AVG': return a.length ? a.reduce((s, _, i) => s + num(ev(i)), 0) / a.length : 0;
      case 'RETAINED': return ctx.offers ? ctx.offers('retained', String(ev(0))) : '';
      case 'MINOFFER': return ctx.offers ? ctx.offers('min', String(ev(0))) : '';
      case 'MAXOFFER': return ctx.offers ? ctx.offers('max', String(ev(0))) : '';
      case 'AVGOFFER': return ctx.offers ? ctx.offers('avg', String(ev(0))) : '';
      case 'COUNTOFFERS': return ctx.offers ? ctx.offers('count', '') : 0;
      default: throw new Error('Fonction inconnue : ' + n);
    }
  }

  const cache = new Map();
  function compile(src) {
    if (!cache.has(src)) cache.set(src, parse(src));
    return cache.get(src);
  }

  /** Évalue une formule. Retourne { ok, value, error } — jamais d'exception. */
  function evaluate(src, ctx) {
    try {
      let v = run(compile(src), ctx || {});
      if (typeof v === 'number' && !Number.isFinite(v)) return { ok: false, value: '', error: '#NOMBRE' };
      if (typeof v === 'number') v = Math.round(v * 1e6) / 1e6;
      return { ok: true, value: v };
    } catch (e) { return { ok: false, value: '', error: e.message }; }
  }

  /** Vérifie la syntaxe (pour l'éditeur admin). */
  function check(src) { try { parse(src); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }

  /** Liste les champs référencés. */
  function deps(src) {
    const out = [];
    try { tokenize(src).forEach(t => { if (t.k === 'ref') out.push(t.v); }); } catch (e) { /* ignore */ }
    return out;
  }

  return { evaluate, check, deps, isBlank, num };
});
