/* Formulaire FAE dynamique : construit à partir du modèle de champs du client. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F, debounce } = AF;
  const toNum = (v) => window.FaeCalc.toNum(v);
  const isBlank = (v) => v === '' || v === null || v === undefined;
  const pscsCache = {};

  /** Fabrique le contrôle d'un champ. ctx = { get(), set(v), currency(), disabled } */
  function control(f, ctx) {
    const model = AF.model();
    const fmtKind = f.type === 'calc' ? ((f.options || {}).format || 'number') : f.type;
    const moneySuffix = () => (/_xof$/.test(f.key) || (f.scope === 'offer' && f.key === 'amount_xof') ? 'CFA' : ctx.currency());
    let el, update = () => {}, setErr = () => {};

    if (f.type === 'calc') {
      el = h('div.calc-val.empty', '—');
      update = () => {
        const v = ctx.get(); const empty = isBlank(v) || v === undefined;
        let txt = '—';
        if (!empty) {
          if (fmtKind === 'money') txt = F.money(v, moneySuffix()); else if (fmtKind === 'percent') txt = F.pct(Number(v)); else if (fmtKind === 'number') txt = F.dec(v, f.decimals ?? 2); else txt = String(v);
        }
        el.textContent = txt; el.className = 'calc-val' + (empty ? ' empty' : (/saving|effort|econom/.test(f.key) && Number(v) > 0 ? ' pos' : (/saving|effort|econom/.test(f.key) && Number(v) < 0 ? ' neg' : '')));
      };
    } else if (f.type === 'textarea') {
      el = h('textarea.inp', { rows: 3, placeholder: f.placeholder || '', value: ctx.get() ?? '', oninput: (e) => ctx.set(e.target.value) });
      update = () => { if (document.activeElement !== el) el.value = ctx.get() ?? ''; };
    } else if (f.type === 'select') {
      const items = Array.isArray(f.options) ? f.options.map((o) => ({ value: o, label: o })) : ((model.lists || {})[f.list_key] || []);
      el = h('select.inp', { onchange: (e) => ctx.set(e.target.value) }, h('option', { value: '' }, '— Choisir —'), items.map((i) => h('option', { value: i.value }, i.label || i.value)));
      const sel = () => { el.value = ctx.get() ?? ''; if (el.value !== (ctx.get() ?? '')) { const cur = ctx.get(); if (cur) { el.appendChild(h('option', { value: cur }, cur + ' (hors liste)')); el.value = cur; } } };
      sel(); update = sel;
    } else if (f.type === 'checkbox') {
      const c = h('input', { type: 'checkbox', checked: !!ctx.get(), onchange: (e) => ctx.set(e.target.checked) });
      el = h('label.check', c, f.label); update = () => { c.checked = !!ctx.get(); };
    } else if (f.type === 'date') {
      el = h('input.inp', { type: 'date', value: ctx.get() || '', onchange: (e) => ctx.set(e.target.value) }); update = () => { el.value = ctx.get() || ''; };
    } else if (f.type === 'number' || f.type === 'money' || f.type === 'percent') {
      const isPct = f.type === 'percent';
      const show = (v) => (isBlank(v) ? '' : F.dec(isPct ? Number(v) * 100 : v, f.type === 'money' ? 2 : (f.decimals ?? 4)));
      const inp = h('input.inp.num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: show(ctx.get()),
        oninput: (e) => { const n = toNum(e.target.value); ctx.set(n === null ? '' : (isPct ? n / 100 : n)); },
        onfocus: (e) => { const v = ctx.get(); e.target.value = isBlank(v) ? '' : String(isPct ? Number(v) * 100 : v).replace('.', ','); e.target.select(); },
        onblur: (e) => { e.target.value = show(ctx.get()); } });
      const suf = h('span.suffix', f.type === 'money' ? moneySuffix() : (isPct ? '%' : ''));
      el = h('div.inwrap', inp, f.type === 'number' ? null : suf);
      update = () => { if (document.activeElement !== inp) inp.value = show(ctx.get()); suf.textContent = f.type === 'money' ? moneySuffix() : (isPct ? '%' : ''); };
      el.inputEl = inp;
    } else if (f.type === 'pscs') {
      const card = h('div.pscs-card', { hidden: true });
      const showCard = (r) => { if (!r) { card.hidden = true; return; } clear(card).append(h('div', h('b', r.code), ' ', r.long_name || r.short_name), h('div.muted', [r.segment, r.family].filter(Boolean).join(' > ')), r.description ? h('div', { style: { marginTop: '4px' } }, r.description) : null); card.hidden = false; };
      const cb = AF.combo({ value: '', placeholder: 'Rechercher un mot-clé ou un code (ex. roulement, 030201)…', disabled: ctx.disabled,
        fetch: async (q) => (await api.get('/lookup/pscs?q=' + encodeURIComponent(q))).rows,
        renderOpt: (r) => [h('b', `${r.code} — ${r.long_name || r.short_name}`), h('span', [r.segment, r.family].filter(Boolean).join(' > '))],
        onPick: (r, inp) => { pscsCache[r.code] = r; inp.value = `${r.code} — ${r.long_name || r.short_name}`; ctx.set(r.code); showCard(r); },
        onText: (t) => { if (!t.trim()) { ctx.set(''); showCard(null); } } });
      el = h('div', cb, card);
      update = async () => {
        const code = ctx.get();
        if (!code) { if (document.activeElement !== cb.input) cb.input.value = ''; showCard(null); return; }
        let r = pscsCache[code];
        if (!r) { try { r = (await api.get('/lookup/pscs/' + encodeURIComponent(code))).row; if (r) pscsCache[code] = r; } catch (e) { /* noop */ } }
        if (r) { if (document.activeElement !== cb.input) cb.input.value = `${r.code} — ${r.long_name || r.short_name}`; showCard(r); } else cb.input.value = code;
      };
      el.inputEl = cb.input;
    } else if (f.type === 'supplier') {
      const cb = AF.combo({ value: ctx.get() || '', placeholder: 'Nom du fournisseur…', fetch: async (q) => (await api.get('/lookup/suppliers?q=' + encodeURIComponent(q))).rows,
        renderOpt: (r) => [h('b', r.name), h('span', [r.ref, r.city, r.country].filter(Boolean).join(', '))],
        onPick: (r, inp) => { inp.value = r.name; ctx.set(r.name, r); }, onText: (t) => ctx.set(t) });
      el = cb; update = () => { if (document.activeElement !== cb.input) cb.input.value = ctx.get() || ''; }; el.inputEl = cb.input;
    } else {
      el = h('input.inp', { type: 'text', value: ctx.get() ?? '', placeholder: f.placeholder || '', oninput: (e) => ctx.set(e.target.value) });
      update = () => { if (document.activeElement !== el) el.value = ctx.get() ?? ''; };
    }
    setErr = (on) => { const t = el.inputEl || el; if (t.classList) t.classList.toggle('err', !!on); };
    if (ctx.disabled) { const t = el.inputEl || el; if ('disabled' in t) t.disabled = true; }
    update();
    return { el, update, setErr };
  }

  AF.views.faeForm = async (host, { params }) => {
    const b = AF.state.boot; const model = AF.model();
    let id = params[0] ? Number(params[0]) : null;
    const maxOffers = Math.min(Number(b.settings.max_offers) || 6, 12);
    const state = { data: {}, offers: [], dirty: false, showErr: false };
    if (id) {
      const f = await api.get('/fae/' + id);
      if (!f.can_edit) { location.hash = '#/fae/' + id; return; }
      state.data = f.data; state.offers = f.offers.map((o) => ({ retained: o.retained, data: o.data }));
    } else {
      model.faeFields.forEach((f) => { if (f.default_value && f.type !== 'calc') state.data[f.key] = f.type === 'number' || f.type === 'money' ? toNum(f.default_value) : f.default_value; });
    }
    while (state.offers.length < Math.min(3, maxOffers)) state.offers.push({ retained: false, data: {} });

    const currencyLabel = () => state.data[model.roleKey('fae', 'currency')] || 'CFA';
    const ctrls = {}; // clé du champ -> { f, wrap, ctl }
    const offerCtrls = []; // [ { fieldKey -> ctl } ]
    let preview = null, lastSaved = null, timer = null;
    const statusEl = h('span.muted.small');
    const summaryBox = h('div.stack');
    const issuesBox = h('div');
    const railBox = h('div');

    const touch = () => { state.dirty = true; recompute(); };
    function recompute() {
      const calc = window.FaeCalc.computeCalcs(model, state.data, state.offers);
      model.faeFields.filter((f) => f.type === 'calc').forEach((f) => { state.data[f.key] = calc.data[f.key]; });
      state.offers.forEach((o, i) => { model.offerFields.filter((f) => f.type === 'calc').forEach((f) => { o.data[f.key] = calc.offers[i].data[f.key]; }); });
      Object.values(ctrls).forEach((c) => { c.wrap.hidden = !window.FaeCalc.isVisible(c.f, state.data); c.ctl.update(); });
      paintMatrixCalc();
      askPreview();
    }

    // ── Sections de la fiche
    const sections = model.sections.filter((s) => s.scope === 'fae');
    const firstKey = sections[0] && sections[0].key;
    const formBody = h('div');
    sections.forEach((s) => {
      const fields = model.faeFields.filter((f) => (f.section_key === s.key) || (!sections.some((x) => x.key === f.section_key) && s.key === firstKey));
      if (!fields.length) return;
      const grid = h('div.fsec-b');
      fields.forEach((f) => {
        const ctx = { get: () => state.data[f.key], set: (v) => { state.data[f.key] = v; touch(); }, currency: currencyLabel };
        const ctl = control(f, ctx);
        const help = f.help ? h('div.help', f.help) : null;
        const wrap = h('div.field.w' + (f.width || 2), f.type === 'checkbox' ? null : h('label', f.label, f.required ? h('span.req', ' *') : null), ctl.el, help);
        if (f.type === 'select' && f.list_key === 'supplier_category') {
          const d = h('div.help'); const upd = () => { const it = ((model.lists.supplier_category || []).find((i) => i.value === state.data[f.key]) || {}).meta; d.textContent = it && it.description ? it.description : ''; };
          const old = ctl.update; ctl.update = () => { old(); upd(); }; wrap.appendChild(d); upd();
        }
        if (f.key === model.roleKey('fae', 'fx_rate')) {
          const d = h('div.help'); const old = ctl.update; ctl.update = () => { old(); const r = window.FaeCalc.currencyRate(model, currencyLabel()); d.textContent = r ? `Taux par défaut ${currencyLabel()} : ${F.dec(r, 4)} (laissez vide pour l'utiliser)` : `Aucun taux par défaut pour ${currencyLabel()} : saisissez-le.`; }; wrap.appendChild(d);
        }
        ctrls[f.key] = { f, wrap, ctl }; grid.appendChild(wrap);
      });
      formBody.appendChild(h('section.fsec', { style: { '--sc': s.color } }, h('div.fsec-h', s.label), grid));
    });

    // ── Fournisseurs consultés (matrice)
    const matrixBox = h('section.fsec', { style: { '--sc': ((model.sections.find((s) => s.scope === 'offer') || {}).color) || '#b4531a' } });
    const offerFields = model.offerFields;
    function paintMatrix() {
      offerCtrls.length = 0; clear(matrixBox);
      const kSup = model.roleKey('offer', 'o_supplier'), kOrigin = model.roleKey('offer', 'o_origin');
      const head = h('tr', h('th', 'Critère'));
      state.offers.forEach((o, i) => head.appendChild(h('th', { class: o.retained ? 'ret' : '' },
        h('div.row.between', h('span', `Fournisseur ${i + 1}`), state.offers.length > 1 ? h('button.btn.ghost.icon.sm', { type: 'button', title: 'Retirer ce fournisseur', 'aria-label': `Retirer le fournisseur ${i + 1}`, onclick: async () => { const filled = Object.values(o.data).some((v) => !isBlank(v)); if (filled && !(await AF.confirmBox('Retirer ce fournisseur ?', 'Les informations saisies pour ce fournisseur seront supprimées.', 'Retirer', 'danger'))) return; state.offers.splice(i, 1); state.dirty = true; paintMatrix(); recompute(); } }, icon('x')) : null),
        h('label.check.small', { style: { marginTop: '4px' } }, h('input', { type: 'radio', name: 'retained', checked: o.retained, onchange: () => { state.offers.forEach((x, j) => { x.retained = j === i; }); state.dirty = true; paintMatrix(); recompute(); } }), 'Fournisseur retenu'))));
      const tbody = h('tbody');
      offerFields.forEach((f) => {
        const tr = h('tr', h('td', f.label, f.required ? h('span.req', { style: { color: 'var(--visa)' } }, ' *') : null, f.help ? h('div.help', { style: { fontWeight: 400 } }, f.help) : null));
        state.offers.forEach((o, i) => {
          const ctx = { get: () => o.data[f.key], currency: currencyLabel, set: (v, row) => { o.data[f.key] = v; if (f.key === kSup && row && row.country && kOrigin && isBlank(o.data[kOrigin])) { o.data[kOrigin] = row.country; } touch(); } };
          const ctl = control(f, ctx);
          (offerCtrls[i] = offerCtrls[i] || {})[f.key] = ctl;
          tr.appendChild(h('td', { class: o.retained ? 'ret' : '', dataset: { k: f.key, i } }, ctl.el));
        });
        tbody.appendChild(tr);
      });
      matrixBox.append(h('div.fsec-h', 'Fournisseurs consultés', h('span.muted.small', { style: { fontWeight: 400 } }, `jusqu'à ${maxOffers}, minimum ${(b.settings.controls || {}).min_offers || 3} recommandés`)),
        h('div.tbl-wrap', h('table.matrix', h('thead', head), tbody)),
        h('div.panel-b', state.offers.length < maxOffers ? h('button.btn.sm', { type: 'button', onclick: () => { state.offers.push({ retained: false, data: {} }); state.dirty = true; paintMatrix(); recompute(); } }, icon('plus'), 'Ajouter un fournisseur') : h('span.muted.small', 'Nombre maximal de fournisseurs atteint.')));
    }
    function paintMatrixCalc() {
      offerCtrls.forEach((c) => Object.values(c || {}).forEach((x) => x.update()));
      // mise en évidence du moins-disant conforme
      const kX = model.roleKey('offer', 'o_amount_xof'), kC = model.roleKey('offer', 'o_conformity');
      if (!kX) return;
      let best = null;
      state.offers.forEach((o, i) => { const v = toNum(o.data[kX]); const conform = !kC || String(o.data[kC] || '').toUpperCase() === 'CONFORME'; if (v !== null && conform && (best === null || v < best.v)) best = { v, i }; });
      matrixBox.querySelectorAll(`td[data-k="${kX}"]`).forEach((td) => { const on = best && Number(td.dataset.i) === best.i && state.offers.filter((o) => toNum(o.data[kX]) !== null).length > 1; td.firstChild.classList.toggle('best', !!on); td.title = on ? 'Moins-disant conforme' : ''; });
    }
    paintMatrix();

    // ── Synthèse et contrôles (source de vérité : serveur)
    const askPreview = debounce(async () => {
      try { preview = await api.post('/fae/preview', payload()); } catch (e) { return; }
      paintSummary();
    }, 450);
    function payload() { return { data: state.data, offers: state.offers.map((o) => ({ data: o.data, retained: o.retained })) }; }
    function paintSummary() {
      if (!preview) return;
      const m = preview.metrics;
      const sb = m.saving_budget_xof, ef = m.effort_xof;
      clear(summaryBox).append(
        h('div.sum-row', h('span', 'Budget'), h('b', m.budget_xof != null ? F.money(m.budget_xof, 'CFA') : '—')),
        h('div.sum-row', h('span', 'Montant final'), h('b', m.final_xof != null ? F.money(m.final_xof, 'CFA') : '—')),
        h('div.sum-row', h('span', 'Savings budget'), h('b', { style: { color: sb == null ? '' : sb >= 0 ? 'var(--ok)' : 'var(--bad)' } }, sb != null ? `${F.money(sb, 'CFA')}${m.budget_xof ? ' (' + F.pct(sb / m.budget_xof) + ')' : ''}` : '—')),
        h('div.sum-row', h('span', 'Effort acheteur'), h('b', { style: { color: ef == null ? '' : ef >= 0 ? 'var(--ok)' : 'var(--bad)' } }, ef != null ? `${F.money(ef, 'CFA')}${m.final_xof != null && (ef + m.final_xof) > 0 ? ' (' + F.pct(ef / (ef + m.final_xof)) + ')' : ''}` : '—')),
        h('div.sum-row', h('span', 'Fournisseurs consultés'), h('b', `${m.offers_count} dont ${m.conform_count} conforme${m.conform_count > 1 ? 's' : ''}`)),
        h('div.sum-row', h('span', 'Fournisseur retenu'), h('b', m.supplier_name || '—')));
      const blocks = preview.issues.filter((i) => i.level === 'block'), warns = preview.issues.filter((i) => i.level === 'warn');
      clear(issuesBox).append(
        preview.issues.length ? preview.issues.map((i) => h('div.issue.' + i.level, icon(i.level === 'block' ? 'x' : 'alert'), h('span', i.message))) : h('div.issue', icon('check'), h('span', 'Aucun point bloquant.')),
        blocks.length ? h('div.help', { style: { marginTop: '6px' } }, `${blocks.length} point${blocks.length > 1 ? 's' : ''} à corriger avant de soumettre.`) : (warns.length ? h('div.help', { style: { marginTop: '6px' } }, 'Les avertissements n\'empêchent pas la soumission.') : null));
      Object.values(ctrls).forEach((c) => c.ctl.setErr(false));
      if (state.showErr) preview.issues.filter((i) => i.field && ctrls[i.field]).forEach((i) => ctrls[i.field].ctl.setErr(true));
    }
    // circuit prévu
    const steps = (b.workflow || []).filter((s) => s.active);
    clear(railBox).appendChild(AF.rail(steps.map((s) => ({ name: s.name.replace(/^Validation\s+/i, ''), state: 'wait', sub: s.condition ? 'selon critères' : (s.sla_hours ? `sous ${F.hours(s.sla_hours)}` : '') })), { mini: true }));

    // ── Enregistrement / soumission
    async function save(silent) {
      const body = payload();
      if (!id) { const r = await api.post('/fae', body); id = r.id; history.replaceState(null, '', '#/fae/' + id + '/edit'); }
      else await api.put('/fae/' + id, body);
      state.dirty = false; lastSaved = new Date();
      statusEl.textContent = `Brouillon enregistré à ${lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      if (!silent) toast('Brouillon enregistré.', 'ok');
    }
    async function submit() {
      state.showErr = true;
      try {
        preview = await api.post('/fae/preview', payload()); paintSummary();
        const blocks = preview.issues.filter((i) => i.level === 'block'), warns = preview.issues.filter((i) => i.level === 'warn');
        if (blocks.length) { AF.modal({ title: 'Cette fiche ne peut pas encore être soumise', body: h('div', blocks.map((i) => h('div.issue.block', icon('x'), h('span', i.message)))), actions: [{ label: 'Corriger', cls: 'primary' }] }); return; }
        if (warns.length && !(await AF.confirmBox('Soumettre malgré les avertissements ?', h('div', warns.map((i) => h('div.issue.warn', icon('alert'), h('span', i.message)))), 'Soumettre', 'visa'))) return;
        if (!warns.length && !(await AF.confirmBox('Soumettre pour validation ?', 'La fiche sera envoyée aux validateurs, qui seront alertés. Vous pourrez la rappeler tant qu\'elle n\'est pas validée.', 'Soumettre', 'visa'))) return;
        if (!id) { const r = await api.post('/fae', payload()); id = r.id; }
        await api.post(`/fae/${id}/submit`, payload());
        state.dirty = false; toast('FAE soumise : les validateurs sont alertés.', 'ok'); location.hash = '#/fae/' + id;
      } catch (e) {
        if (e.data && e.data.issues) AF.modal({ title: 'Fiche non soumise', body: h('div', e.data.issues.map((i) => h('div.issue.block', icon('x'), h('span', i.message)))), actions: [{ label: 'Corriger', cls: 'primary' }] }); else fail(e);
      }
    }

    clear(host).append(
      h('div.form-head', h('div', h('h1', id ? 'Modifier la FAE' : 'Nouvelle FAE'), h('div.muted', 'Renseignez la fiche : les calculs et les contrôles se mettent à jour en direct.')), h('div', statusEl)),
      h('div.split', h('div', formBody, matrixBox),
        h('aside.summary', h('div.panel', h('div.panel-h', h('h3', 'Synthèse')), h('div.panel-b', summaryBox)),
          h('div.panel', h('div.panel-h', h('h3', 'Contrôles')), h('div.panel-b', issuesBox)),
          h('div.panel', h('div.panel-h', h('h3', 'Circuit de validation')), h('div.panel-b', railBox)))),
      h('div.savebar', h('a.btn.ghost', { href: id ? '#/fae/' + id : '#/fae' }, 'Quitter'),
        h('div.row', h('button.btn', { type: 'button', onclick: async (e) => { e.target.disabled = true; try { await save(); } catch (x) { fail(x); } e.target.disabled = false; } }, 'Enregistrer le brouillon'),
          h('button.btn.visa', { type: 'button', onclick: submit }, icon('send'), 'Soumettre pour validation'))));
    recompute();
    // sauvegarde automatique des brouillons existants
    const auto = setInterval(async () => { if (id && state.dirty) { try { await save(true); } catch (e) { /* silencieux */ } } }, 60000);
    const guard = (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => { clearInterval(auto); window.removeEventListener('beforeunload', guard); };
  };
})();
