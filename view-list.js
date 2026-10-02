/* Liste des FAE, écran « à valider », extractions. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, F, qs, iso, debounce } = AF;
  const STATUSES = [['draft', 'Brouillon'], ['in_review', 'En validation'], ['approved', 'Validée'], ['rejected', 'Rejetée']];

  function presetRange(kind) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    return { month: { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) }, lastmonth: { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
      quarter: (() => { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; })(), year: { from: `${y}-01-01`, to: `${y}-12-31` }, all: { from: '', to: '' } }[kind];
  }

  /** Bloc de critères réutilisé par la liste et l'écran d'extraction. */
  function criteria(st, onChange, { advanced } = {}) {
    const b = AF.state.boot; const L = b.lists;
    const opts = (arr, cur) => [h('option', { value: '' }, 'Tous'), ...arr.map((x) => h('option', { value: x.value ?? x, selected: String(x.value ?? x) === String(cur) }, x.label ?? x))];
    const set = (k) => (e) => { st[k] = e.target.value; onChange(); };
    const inp = (k, type, ph) => h('input.inp', { type, value: st[k] || '', placeholder: ph, onchange: set(k), oninput: type === 'text' ? debounce(set(k), 350) : null });
    const showBuyer = !(AF.is('buyer') && !b.settings.buyers_see_all);
    const buyers = b.users.filter((u) => ['buyer', 'admin'].includes(u.role)).map((u) => ({ value: u.id, label: u.name }));
    const chips = h('div.chips');
    const paintChips = () => { clear(chips); STATUSES.forEach(([k, l]) => { const on = (st.status || '').split(',').includes(k); chips.appendChild(h('button.chip' + (on ? '.on' : ''), { type: 'button', onclick: () => { const cur = (st.status || '').split(',').filter(Boolean); st.status = (on ? cur.filter((x) => x !== k) : [...cur, k]).join(','); paintChips(); onChange(); } }, l)); }); };
    paintChips();
    const from = inp('from', 'date'), to = inp('to', 'date');
    const presets = h('select.inp', { onchange: (e) => { const r = presetRange(e.target.value); if (!r) return; st.from = r.from; st.to = r.to; from.value = r.from; to.value = r.to; e.target.value = ''; onChange(); } },
      h('option', { value: '' }, 'Raccourcis…'), h('option', { value: 'month' }, 'Ce mois'), h('option', { value: 'lastmonth' }, 'Mois précédent'), h('option', { value: 'quarter' }, 'Trimestre en cours'), h('option', { value: 'year' }, 'Année en cours'), h('option', { value: 'all' }, 'Toutes les dates'));
    const basis = h('select.inp', { onchange: set('basis') }, [['created', 'Date de création'], ['submitted', 'Date de soumission'], ['validated', 'Date de validation'], ['launch', 'Date de lancement']].map(([v, l]) => h('option', { value: v, selected: (st.basis || 'created') === v }, l)));
    return h('div',
      h('div.filters',
        h('div.field.grow', { style: { minWidth: '220px' } }, h('label', 'Recherche'), inp('q', 'text', 'N° FAE, objet, fournisseur, PR…')),
        h('div.field', h('label', 'Statut'), chips)),
      h('div.filters', { style: { borderTop: '1px solid var(--line-soft)' } },
        advanced ? h('div.field.s', h('label', 'Période sur'), basis) : null,
        h('div.field.s', h('label', 'Du'), from), h('div.field.s', h('label', 'Au'), to), h('div.field.s', h('label', 'Raccourci'), presets),
        h('div.field.s', h('label', 'Département'), h('select.inp', { onchange: set('department') }, opts(L.department || [], st.department))),
        showBuyer ? h('div.field.s', h('label', 'Acheteur'), h('select.inp', { onchange: set('buyer_id') }, opts(buyers, st.buyer_id))) : null,
        advanced ? [
          h('div.field.s', h('label', 'Type d\'achat'), h('select.inp', { onchange: set('purchase_type') }, opts(L.purchase_type || [], st.purchase_type))),
          h('div.field.s', h('label', 'Stratégie'), h('select.inp', { onchange: set('strategy') }, opts(L.strategy || [], st.strategy))),
          h('div.field.s', h('label', 'Nature'), h('select.inp', { onchange: set('spend_nature') }, opts(L.spend_nature || [], st.spend_nature))),
          h('div.field.s', h('label', 'Fournisseur retenu'), inp('supplier', 'text', 'Nom…')),
          h('div.field.s', h('label', 'Montant final min (CFA)'), inp('min_amount', 'number', '0')), h('div.field.s', h('label', 'Montant final max (CFA)'), inp('max_amount', 'number', ''))] : null));
  }
  const crit = (st, extra) => qs({ q: st.q, status: st.status, from: st.from, to: st.to, basis: st.basis, department: st.department, buyer_id: st.buyer_id, purchase_type: st.purchase_type, strategy: st.strategy, spend_nature: st.spend_nature, supplier: st.supplier, min_amount: st.min_amount, max_amount: st.max_amount, ...(extra || {}) });

  // ── Liste
  AF.views.faeList = async (host, { query }) => {
    const b = AF.state.boot;
    const st = AF.listState = Object.assign({ page: 1, sort: 'created', dir: 'desc' }, AF.listState || {}, query.status ? { status: query.status, page: 1 } : {});
    const tableBox = h('div');
    const onChange = () => { st.page = 1; load(); };
    async function load() {
      clear(tableBox).appendChild(h('div.spinner'));
      let r; try { r = await api.get('/fae?' + crit(st, { page: st.page, limit: 25, sort: st.sort, dir: st.dir })); } catch (e) { clear(tableBox); return fail(e); }
      const th = (label, key, cls) => h('th.sort' + (st.sort === key ? '.on' : '') + (cls ? '.' + cls : ''), { onclick: () => { if (st.sort === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = key; st.dir = 'desc'; } load(); }, 'aria-sort': st.sort === key ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, label, st.sort === key ? icon(st.dir === 'asc' ? 'up' : 'down') : null);
      clear(tableBox);
      if (!r.rows.length) { tableBox.appendChild(h('div.empty-state', h('h3', 'Aucune FAE'), h('p', 'Aucune fiche ne correspond à ces critères.'), AF.is('buyer', 'admin') ? h('a.btn.primary', { href: '#/fae/new' }, icon('plus'), 'Créer une FAE') : null)); return; }
      const pages = Math.ceil(r.total / r.limit);
      tableBox.append(h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', th('N°', 'number'), h('th', 'Objet'), h('th.hide-m', 'Acheteur'), h('th.hide-m', 'Département'), th('Fournisseur retenu', 'supplier'), th('Montant final', 'amount', 'num'), h('th.num.hide-m', 'Savings'), h('th', 'Statut'), th('Créée le', 'created'))),
        h('tbody', r.rows.map((f) => h('tr.click', { onclick: () => { location.hash = f.status === 'draft' || f.status === 'rejected' ? (AF.state.user.id === f.buyer_id ? '#/fae/' + f.id : '#/fae/' + f.id) : '#/fae/' + f.id; } },
          h('td.strong.nowrap', f.number), h('td', { style: { maxWidth: '300px' } }, f.title || '—', f.pr_number ? h('span.sub', 'PR ' + f.pr_number) : null),
          h('td.hide-m', f.buyer_name), h('td.hide-m', f.department || '—'), h('td', f.supplier_name || h('span.faint', '—')),
          h('td.num.strong.nowrap', f.final_xof != null ? F.money(f.final_xof) : '—', f.final_xof != null ? h('span.sub', 'CFA') : null),
          h('td.num.hide-m', f.saving_budget_pct != null ? h('span', { style: { color: f.saving_budget_pct >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 650 } }, F.pct(f.saving_budget_pct)) : '—'),
          h('td', AF.statusPill(f.status), f.status === 'in_review' && f.step_name ? h('span.sub', f.step_name) : null), h('td.nowrap', F.date(f.created_at))))))),
      h('div.pager', h('span', `${r.total} fiche${r.total > 1 ? 's' : ''}`), h('div.row.gap-s', h('button.btn.sm', { disabled: st.page <= 1, onclick: () => { st.page--; load(); } }, 'Précédent'), h('span', `Page ${st.page} / ${pages}`), h('button.btn.sm', { disabled: st.page >= pages, onclick: () => { st.page++; load(); } }, 'Suivant'))));
    }
    clear(host).append(
      h('div.page-head', h('div', h('h1', AF.is('buyer') && !b.settings.buyers_see_all ? 'Mes FAE' : 'Toutes les FAE'), h('div.sub', 'Fiches d\'analyse d\'expression de besoin')),
        h('div.actionbar', h('a.btn', { href: '#/export?' + crit(st) }, icon('download'), 'Extraire ces résultats'), AF.is('buyer', 'admin') ? h('a.btn.primary', { href: '#/fae/new' }, icon('plus'), 'Nouvelle FAE') : null)),
      h('div.panel', criteria(st, onChange), tableBox));
    await load();
  };

  // ── À valider
  AF.views.approvals = async (host) => {
    const r = await api.get('/fae/approvals');
    clear(host).append(h('div.page-head', h('div', h('h1', 'À valider'), h('div.sub', 'Fiches qui attendent votre visa'))));
    if (!r.items.length) { host.appendChild(h('div.panel', h('div.empty-state', h('h3', 'Rien à valider pour le moment'), h('p', 'Vous serez alerté par e-mail ou WhatsApp dès qu\'une fiche vous est soumise.')))); return; }
    host.appendChild(h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'N°'), h('th', 'Objet'), h('th.hide-m', 'Acheteur'), h('th', 'Fournisseur retenu'), h('th.num', 'Montant final'), h('th', 'Étape'), h('th', 'Échéance'))),
      h('tbody', r.items.map((i) => h('tr.click', { onclick: () => { location.hash = '#/fae/' + i.fae_id; } },
        h('td.strong.nowrap', i.number), h('td', i.title || '—', h('span.sub', i.department || '')), h('td.hide-m', i.buyer_name), h('td', i.supplier_name || '—'), h('td.num.strong.nowrap', F.money(i.final, i.currency)),
        h('td', i.step_name), h('td.nowrap', i.due_at ? h('span', { style: { color: i.overdue ? 'var(--bad)' : 'inherit', fontWeight: i.overdue ? 700 : 400 } }, F.until(i.due_at)) : '—'))))))));
  };

  // ── Extractions
  AF.views.exportView = async (host, { query }) => {
    const b = AF.state.boot;
    const st = Object.assign({ basis: 'created' }, query);
    const info = h('div.sum-big', '…'); const infoSub = h('div.muted');
    const btns = h('div.stack.s');
    const refresh = debounce(async () => {
      try { const r = await api.get('/export/count?' + crit(st)); info.textContent = `${r.count} fiche${r.count > 1 ? 's' : ''}`; infoSub.textContent = `Montant final cumulé : ${F.money(r.amount, 'CFA')}`; paintBtns(r.count); } catch (e) { fail(e); }
    }, 250);
    function paintBtns(n) {
      clear(btns);
      const q = crit(st);
      const bulk = AF.has('bulk_export');
      btns.append(
        h('button.btn.primary', { disabled: !n || !bulk, onclick: () => AF.download('/api/export/xlsx?' + q) }, icon(bulk ? 'download' : 'lock'), 'Excel complet (fiches et fournisseurs)'),
        h('button.btn', { disabled: !n, onclick: () => AF.download('/api/export/csv?' + q) }, icon('download'), 'CSV (synthèse)'),
        h('button.btn', { disabled: !n || !bulk, onclick: () => window.open('/api/export/pdf?' + q, '_blank') }, icon(bulk ? 'file' : 'lock'), 'PDF des fiches (200 max)'),
        bulk ? null : h('div.help', 'Les exports Excel et PDF nécessitent l\'option « Extractions en masse » de la licence Business.'));
    }
    clear(host).append(
      h('div.page-head', h('div', h('h1', 'Extractions'), h('div.sub', 'Exportez les fiches par période ou selon vos critères'))),
      h('div.split.wide', h('div.panel', h('div.panel-h', h('h3', 'Critères')), criteria(st, refresh, { advanced: true })),
        h('div.summary', h('div.panel', h('div.panel-b.stack', h('div', h('div.muted', 'Résultat de l\'extraction'), info, infoSub), btns)),
          h('div.notice.info', icon('info'), h('div', 'Le fichier Excel contient une ligne par FAE avec tous les champs de votre fiche, une feuille détaillant chaque fournisseur consulté, et une feuille rappelant les critères utilisés.')))));
    refresh();
  };
})();
