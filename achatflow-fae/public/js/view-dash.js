/* Tableau de bord achats : KPIs, graphiques, alertes. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, F, qs, iso } = AF;
  const C = { brand: '#2f5d8a', visa: '#d4501e', ok: '#1e7f5c', warn: '#a86a00', ink: '#101a30', grey: '#b7c0d0', teal: '#3d8f9a', sand: '#8a6f4d' };
  const PALETTE = ['#2f5d8a', '#d4501e', '#1e7f5c', '#a86a00', '#6b5b95', '#3d8f9a', '#8a6f4d', '#7a8399'];

  function period(kind) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (kind === 'month') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    if (kind === 'quarter') { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
    if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (kind === 'last12') return { from: iso(new Date(y, m - 11, 1)), to: iso(now) };
    return { from: '', to: '' };
  }

  AF.views.dashboard = async (host) => {
    const b = AF.state.boot; const charts = [];
    const st = AF.dashState = AF.dashState || { preset: 'year', ...period('year'), department: '', buyer_id: '', scope: 'approved' };
    const body = h('div');
    const depts = (b.lists.department || []).map((d) => d.value);
    const buyers = (b.users || []).filter((u) => ['buyer', 'admin'].includes(u.role));
    const chipsEl = h('div.chips');
    const presets = [['month', 'Ce mois'], ['quarter', 'Trimestre'], ['year', 'Année en cours'], ['last12', '12 derniers mois'], ['all', 'Tout'], ['custom', 'Personnalisé']];
    const from = h('input.inp', { type: 'date', value: st.from, onchange: (e) => { st.from = e.target.value; st.preset = 'custom'; load(); paintChips(); } });
    const to = h('input.inp', { type: 'date', value: st.to, onchange: (e) => { st.to = e.target.value; st.preset = 'custom'; load(); paintChips(); } });
    function paintChips() { clear(chipsEl); presets.forEach(([k, l]) => chipsEl.appendChild(h('button.chip' + (st.preset === k ? '.on' : ''), { type: 'button', onclick: () => { st.preset = k; if (k !== 'custom') Object.assign(st, period(k)); from.value = st.from; to.value = st.to; paintChips(); load(); } }, l))); }
    paintChips();
    const sel = (opts, val, cb) => h('select.inp', { onchange: (e) => cb(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));

    clear(host).append(
      h('div.page-head', h('div', h('h1', 'Tableau de bord'), h('div.sub', AF.is('buyer') && !b.settings.buyers_see_all ? 'Vos fiches d\'analyse' : 'Ensemble des fiches d\'analyse de ' + b.tenant.name))),
      h('div.dash-filters', h('div.field', h('label', 'Période (date de création)'), chipsEl), h('div.field.s', h('label', 'Du'), from), h('div.field.s', h('label', 'Au'), to),
        h('div.field.s', h('label', 'Département'), sel([['', 'Tous'], ...depts.map((d) => [d, d])], st.department, (v) => { st.department = v; load(); })),
        AF.is('buyer') && !b.settings.buyers_see_all ? null : h('div.field.s', h('label', 'Acheteur'), sel([['', 'Tous'], ...buyers.map((u) => [String(u.id), u.name])], st.buyer_id, (v) => { st.buyer_id = v; load(); })),
        h('div.field.s', h('label', 'Fiches prises en compte'), sel([['approved', 'Validées'], ['active', 'Validées et en cours']], st.scope, (v) => { st.scope = v; load(); }))),
      body);

    const kill = () => { charts.splice(0).forEach((c) => c.destroy()); };
    async function load() {
      kill(); clear(body).appendChild(h('div.spinner'));
      let d;
      try { d = await api.get('/dashboard?' + qs({ from: st.from, to: st.to, department: st.department, buyer_id: st.buyer_id, scope: st.scope })); } catch (e) { clear(body); return fail(e); }
      paint(d);
    }

    function kpi(k, v, unit, c, cls) { return h('div.kpi', h('div.k', k), h('div.v' + (cls ? '.' + cls : ''), v, unit ? h('small', unit) : null), h('div.c', c || '\u00a0')); }
    const panel = (title, content, cls, sub) => h('div.panel.' + cls, h('div.panel-h', h('h3', title), sub ? h('span.small.muted', sub) : null), content);
    const canvas = (cls) => { const c = h('canvas'); return { box: h('div.chart-box' + (cls ? '.' + cls : ''), c), c }; };
    const barRows = (rows, { max, fmt = F.compact, cls } = {}) => {
      const mx = max || Math.max(1, ...rows.map((r) => r.v));
      return h('div.bars', rows.length ? rows.map((r) => h('div.bar-row', h('div', { title: r.label, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label), h('div.tr', h('div.fl' + (r.cls ? '.' + r.cls : ''), { style: { width: Math.min(100, (r.v / mx) * 100) + '%' } })), h('b.nowrap', fmt(r.v), r.note ? h('span.muted', { style: { fontWeight: 400 } }, ' ' + r.note) : null))) : h('div.muted', 'Aucune donnée.'));
    };

    function paint(d) {
      const k = d.kpis; clear(body);
      if (!k.count && !Object.keys(d.pipeline || {}).length) {
        body.appendChild(h('div.panel', h('div.empty-state', h('h3', 'Aucune fiche sur cette période'), h('p', 'Élargissez la période ou créez votre première FAE.'), AF.is('buyer', 'admin') ? h('a.btn.primary', { href: '#/fae/new' }, icon('plus'), 'Nouvelle FAE') : null)));
        return;
      }
      body.appendChild(h('div.kpi-strip',
        kpi('Dépenses engagées', F.compact(k.spend_xof), 'CFA', `${k.count} FAE, moyenne ${F.compact(k.avg_amount_xof)}`),
        kpi('Effort acheteur', F.compact(k.effort_xof), 'CFA', F.pct(k.effort_pct) + ' du prix de référence', k.effort_xof > 0 ? 'pos' : ''),
        kpi('Savings budget', F.compact(k.saving_budget_xof), 'CFA', F.pct(k.saving_budget_pct) + ' du budget', k.saving_budget_xof >= 0 ? 'pos' : 'neg'),
        kpi('Mise en concurrence', F.pct(k.competition_rate, 0), '', `${F.dec(k.avg_offers, 1)} offres en moyenne, ${F.pct(k.single_source_rate, 0)} mono-source`),
        kpi('Délai de validation', F.hours(k.avg_validation_hours), '', `Cycle complet : ${F.days(k.avg_cycle_days)}`),
        kpi('Offres conformes', F.pct(k.conform_rate, 0), '', `Dérogations : ${F.pct(k.derogation_rate, 0)}`)));

      // pipeline
      const pl = d.pipeline || {}; const order = [['draft', 'Brouillons'], ['in_review', 'En validation'], ['approved', 'Validées'], ['rejected', 'Rejetées']];
      body.appendChild(h('div.row.wrap.mt', order.map(([s, l]) => h('a.tag', { href: '#/fae?status=' + s, style: { padding: '5px 12px', fontSize: '13px', textDecoration: 'none' } }, AF.statusPill(s, l), ' ', h('b', String((pl[s] || {}).count || 0))))));

      const grid = h('div.charts'); body.appendChild(grid);

      // évolution mensuelle
      const m = canvas('tall');
      grid.appendChild(panel('Évolution mensuelle des dépenses', m.box, 'c8', 'CFA, par mois de création'));
      charts.push(new Chart(m.c, { data: { labels: d.monthly.map((x) => F.month(x.month)), datasets: [
        { type: 'bar', label: 'Dépenses', data: d.monthly.map((x) => x.spend), backgroundColor: C.brand, borderRadius: 3, order: 2 },
        { type: 'line', label: 'Effort acheteur', data: d.monthly.map((x) => x.effort), borderColor: C.visa, backgroundColor: C.visa, tension: .3, pointRadius: 3, order: 1 },
        { type: 'line', label: 'Savings budget', data: d.monthly.map((x) => x.saving_budget), borderColor: C.ok, backgroundColor: C.ok, tension: .3, pointRadius: 3, borderDash: [5, 4], order: 1 }] },
      options: chartOpts({ y: (v) => F.compact(v) }) }));

      // alertes
      grid.appendChild(panel('Points d\'attention', h('div.alert-list', d.alerts.length ? d.alerts.map((a) => h('a.a.' + a.level, { href: '#/fae/' + a.fae_id, style: { color: 'inherit', textDecoration: 'none' } }, icon(a.level === 'danger' ? 'clock' : a.level === 'warn' ? 'alert' : 'info'), a.text)) : h('div.empty-state', 'Rien à signaler.')), 'c4'));

      // domaines d'achat
      grid.appendChild(panel('Dépenses par domaine d\'achat', barRows(d.bySegment.slice(0, 8).map((s) => ({ label: s.name, v: s.spend, note: `(${s.count})` }))), 'c6', 'Segments PSCS'));
      // fournisseurs
      grid.appendChild(panel('Principaux fournisseurs retenus', barRows(d.suppliers.top.slice(0, 8).map((s) => ({ label: s.supplier, v: s.spend, note: `(${s.count})` }))), 'c6', d.suppliers.top5_share != null ? `Top 5 = ${F.pct(d.suppliers.top5_share, 0)} des dépenses` : ''));

      if (d.limited) {
        grid.appendChild(h('div.panel.c12', h('div.lockbox', h('div', icon('lock'), h('h3', { style: { margin: '8px 0 4px' } }, 'Tableaux de bord avancés'), h('p', 'Suivi budgétaire, performance des acheteurs, durées par étape de validation et répartitions détaillées : disponibles avec la licence Enterprise.')))));
        return;
      }
      // budgets par département
      const bud = d.deptBudget.filter((x) => x.budget || x.consumed).slice(0, 10);
      grid.appendChild(panel(`Consommation budgétaire ${d.budget_year}`, barRows(bud.map((x) => ({ label: x.department, v: x.budget ? (x.consumed / x.budget) * 100 : 0, cls: x.budget && x.consumed > x.budget ? 'over' : (x.budget && x.consumed / x.budget > .85 ? 'warn' : ''), note: `${F.compact(x.consumed)} / ${x.budget ? F.compact(x.budget) : 'pas de budget'}` })), { max: 100, fmt: (v) => (v ? Math.round(v) + ' %' : '') }), 'c7', 'Validées et en cours, en CFA'));

      // performance acheteurs
      grid.appendChild(panel('Performance des acheteurs', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Acheteur'), h('th.num', 'FAE'), h('th.num', 'Dépenses'), h('th.num', 'Effort'), h('th.num', 'Cycle'))),
        h('tbody', d.byBuyer.map((x) => h('tr', h('td.strong', x.buyer), h('td.num', String(x.count)), h('td.num', F.compact(x.spend)), h('td.num', F.pct(x.effort_pct)), h('td.num', F.days(x.avg_days))))))), 'c5'));

      // répartitions
      const dn = (title, rows, cls) => { const cv = canvas('short'); grid.appendChild(panel(title, cv.box, cls || 'c4')); charts.push(new Chart(cv.c, { type: 'doughnut', data: { labels: rows.map((r) => r.name), datasets: [{ data: rows.map((r) => r.spend), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 12 } } }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${F.compact(c.parsed)} CFA` } } } } })); };
      dn('Par type d\'achat', d.byType); dn('Par stratégie achat', d.byStrategy); dn('CAPEX / OPEX', d.byNature);

      // workflow
      const wsteps = d.workflow.steps.map((x) => ({ label: x.step, v: x.hours || 0, note: `(${x.count})` }));
      grid.appendChild(panel('Durée moyenne de validation par étape', barRows(wsteps, { fmt: F.hours }), 'c6'));
      grid.appendChild(panel('Fiches en attente de validation', h('div.tbl-wrap', d.workflow.pending.length ? h('table.tbl', h('thead', h('tr', h('th', 'Étape'), h('th.num', 'En attente'), h('th.num', 'En retard'))), h('tbody', d.workflow.pending.map((x) => h('tr', h('td.strong', x.step), h('td.num', String(x.n)), h('td.num', x.overdue ? h('b', { style: { color: 'var(--bad)' } }, String(x.overdue)) : '0'))))) : h('div.empty-state', 'Aucune fiche en attente.')), 'c6'));
    }

    function chartOpts({ y }) {
      return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${F.money(c.parsed.y, 'CFA')}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: y }, grid: { color: '#e6eaf0' }, beginAtZero: true } } };
    }
    if (window.Chart) { Chart.defaults.font.family = "'Hanken Grotesk', system-ui, sans-serif"; Chart.defaults.color = '#3a4762'; }
    await load();
    return kill;
  };
})();
