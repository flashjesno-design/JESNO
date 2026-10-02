/* Fiche FAE en lecture : circuit de visas, données, fournisseurs, pièces jointes, historique. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F } = AF;
  const isBlank = (v) => v === '' || v === null || v === undefined;
  const EV_ICON = { created: 'plus', submitted: 'send', step_approved: 'check', approved: 'check', rejected: 'x', recalled: 'undo', comment: 'comment', attachment: 'clip', reminder: 'bell', escalation: 'alert', cancelled: 'x' };

  function fmt(f, v, currency) {
    if (isBlank(v)) return '';
    const kind = f.type === 'calc' ? ((f.options || {}).format || 'number') : f.type;
    if (kind === 'money') return F.money(v, /_xof$/.test(f.key) ? 'CFA' : currency);
    if (kind === 'percent') return F.pct(Number(v));
    if (kind === 'number') return F.dec(v, f.decimals ?? 2);
    if (kind === 'date') return F.date(v);
    if (kind === 'checkbox') return v ? 'Oui' : 'Non';
    return String(v);
  }

  AF.views.faeDetail = async (host, ctx) => {
    const id = Number(ctx.params[0]); const b = AF.state.boot; const model = AF.model(); const me = AF.state.user;
    async function load(stamp) {
      const f = await api.get('/fae/' + id);
      const cur = f.currency || 'CFA';
      const cyc = f.steps.filter((s) => s.cycle === f.cycle);
      const shown = cyc.filter((s) => s.status !== 'skipped');
      const railSteps = f.status === 'draft' && !cyc.length
        ? (b.workflow || []).filter((s) => s.active).map((s) => ({ name: s.name.replace(/^Validation\s+/i, ''), state: 'wait', sub: 'Non soumise' }))
        : shown.map((s) => ({ name: s.name.replace(/^Validation\s+/i, ''), state: s.status === 'approved' ? 'done' : s.status === 'pending' ? 'now' : s.status === 'rejected' ? 'bad' : 'wait',
          sub: s.status === 'approved' ? `${s.acted_by_name}, ${F.date(s.acted_at)}` : s.status === 'pending' ? (s.due_at ? 'À valider, ' + F.until(s.due_at) : 'À valider') : s.status === 'rejected' ? `Rejetée par ${s.acted_by_name}` : s.status === 'cancelled' ? 'Annulée' : 'En attente' }));
      const stampIdx = stamp ? shown.findIndex((s) => s.id === stamp) : -1;
      const rejEv = f.status === 'rejected' ? [...f.events].reverse().find((e) => e.type === 'rejected') : null;
      const pendingStep = f.steps.find((s) => s.id === f.current_step_id);

      // actions
      const actions = h('div.actionbar');
      if (f.can_edit) actions.append(h('a.btn.primary', { href: `#/fae/${id}/edit` }, icon('edit'), f.status === 'rejected' ? 'Corriger et resoumettre' : 'Modifier et soumettre'));
      if (f.can_recall) actions.append(h('button.btn', { onclick: async () => { if (await AF.confirmBox('Rappeler la FAE ?', 'Elle repassera en brouillon et le circuit de validation sera interrompu.', 'Rappeler')) { try { await api.post(`/fae/${id}/recall`); toast('FAE rappelée.', 'ok'); load(); refreshBadges(); } catch (e) { fail(e); } } } }, icon('undo'), 'Rappeler'));
      actions.append(h('a.btn', { href: `/api/fae/${id}/pdf`, target: '_blank', rel: 'noopener' }, icon('file'), 'PDF'));
      if (AF.is('buyer', 'admin')) actions.append(h('button.btn', { onclick: async () => { try { const r = await api.post(`/fae/${id}/duplicate`); toast('Copie créée en brouillon.', 'ok'); location.hash = `#/fae/${r.id}/edit`; } catch (e) { fail(e); } } }, icon('copy'), 'Dupliquer'));
      if (['draft', 'rejected', 'cancelled'].includes(f.status) && (f.buyer_id === me.id || AF.is('admin'))) actions.append(h('button.btn.danger', { onclick: async () => { if (await AF.confirmBox('Supprimer la FAE ?', `La fiche ${f.number} sera supprimée définitivement.`, 'Supprimer', 'danger')) { try { await api.delete('/fae/' + id); toast('FAE supprimée.', 'ok'); location.hash = '#/fae'; } catch (e) { fail(e); } } } }, icon('trash'), 'Supprimer'));

      // KPI
      const sb = f.saving_budget_xof, ef = f.effort_xof;
      const kpis = h('div.kpi-strip',
        h('div.kpi', h('div.k', 'Montant final'), h('div.v', f.final != null ? F.money(f.final) : '—', h('small', cur)), h('div.c', cur !== 'CFA' && f.final_xof != null ? '= ' + F.money(f.final_xof, 'CFA') : 'Offre initiale : ' + (f.initial != null ? F.money(f.initial, cur) : '—'))),
        h('div.kpi', h('div.k', 'Budget'), h('div.v', f.budget != null ? F.money(f.budget) : '—', h('small', cur)), h('div.c', f.budget_xof != null && f.final_xof != null && f.final_xof > f.budget_xof ? 'Dépassement de ' + F.money(f.final_xof - f.budget_xof, 'CFA') : ' ')),
        h('div.kpi', h('div.k', 'Savings budget'), h('div.v' + (sb == null ? '' : sb >= 0 ? '.pos' : '.neg'), sb != null ? F.compact(sb) : '—', h('small', 'CFA')), h('div.c', F.pct(f.saving_budget_pct))),
        h('div.kpi', h('div.k', 'Effort acheteur'), h('div.v' + (ef == null ? '' : ef >= 0 ? '.pos' : '.neg'), ef != null ? F.compact(ef) : '—', h('small', 'CFA')), h('div.c', F.pct(f.effort_pct))),
        h('div.kpi', h('div.k', 'Consultation'), h('div.v', `${f.offers_count}`, h('small', 'fournisseurs')), h('div.c', `${f.conform_count} offre${f.conform_count > 1 ? 's' : ''} conforme${f.conform_count > 1 ? 's' : ''}`)));

      // sections en lecture
      const pscsBox = {};
      const secs = model.sections.filter((s) => s.scope === 'fae');
      const firstKey = secs[0] && secs[0].key;
      const secEls = secs.map((s) => {
        const fields = model.faeFields.filter((x) => ((x.section_key === s.key) || (!secs.some((y) => y.key === x.section_key) && s.key === firstKey)) && window.FaeCalc.isVisible(x, f.data));
        if (!fields.length) return null;
        return h('section.fsec', { style: { '--sc': s.color } }, h('div.fsec-h', s.label), h('div.panel-b', h('div.dgrid', fields.map((x) => {
          const v = f.data[x.key]; let node;
          if (x.type === 'pscs' && v) { node = h('div.v', v); pscsBox[x.key] = node; }
          else { const t = fmt(x, v, cur); node = h('div.v' + (t ? '' : '.empty'), t || 'Non renseigné'); }
          return h('div', { style: { gridColumn: `span ${Math.min(4, x.width || 2)}` } }, h('div.k', x.label), node);
        }))));
      }).filter(Boolean);
      Object.keys(pscsBox).forEach(async (k) => { try { const r = (await api.get('/lookup/pscs/' + encodeURIComponent(f.data[k]))).row; if (r) { clear(pscsBox[k]).append(h('b', r.code), ' ' + (r.long_name || r.short_name), h('div.muted.small', [r.segment, r.family].filter(Boolean).join(' > '))); } } catch (e) { /* noop */ } });

      // fournisseurs
      const offerEl = f.offers.length ? h('section.fsec', { style: { '--sc': '#b4531a' } }, h('div.fsec-h', 'Fournisseurs consultés'), h('div.tbl-wrap', h('table.matrix', h('thead', h('tr', h('th', 'Critère'), f.offers.map((o, i) => h('th', { class: o.retained ? 'ret' : '' }, o.retained ? h('span', icon('check'), ' Retenu') : `Fournisseur ${i + 1}`)))),
        h('tbody', model.offerFields.map((x) => h('tr', h('td', x.label), f.offers.map((o) => { const t = fmt(x, o.data[x.key], cur); return h('td', { class: (o.retained ? 'ret' : '') }, x.role === 'o_supplier' ? h('b', t || '—') : (t || h('span.faint', '—'))); }))))))) : null;

      // pièces jointes
      const canUp = AF.has('attachments') && !['approved', 'cancelled'].includes(f.status);
      const fileInp = h('input', { type: 'file', hidden: true, onchange: async (e) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); try { await api.post(`/fae/${id}/attachments`, fd); toast('Pièce jointe ajoutée.', 'ok'); load(); } catch (x) { fail(x); } } });
      const attach = h('div.panel', h('div.panel-h', h('h3', 'Pièces jointes'), canUp ? h('button.btn.sm', { onclick: () => fileInp.click() }, icon('upload'), 'Ajouter') : null, fileInp),
        h('div', f.attachments.length ? f.attachments.map((a) => h('div.frow', { style: { gridTemplateColumns: '20px 1fr auto' } }, icon('clip'), h('div', h('a', { href: `/api/fae/${id}/attachments/${a.id}` }, a.filename), h('div.meta', `${Math.max(1, Math.round((a.size || 0) / 1024))} Ko, ${F.date(a.created_at)}`)),
          (a.uploaded_by === me.id || AF.is('admin')) && f.status !== 'approved' ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Supprimer', onclick: async () => { if (await AF.confirmBox('Supprimer la pièce jointe ?', a.filename, 'Supprimer', 'danger')) { try { await api.delete(`/fae/${id}/attachments/${a.id}`); load(); } catch (x) { fail(x); } } } }, icon('trash')) : null)) : h('div.panel-b.muted.small', AF.has('attachments') ? 'Aucune pièce jointe (devis, fiche de dérogation, PV de comité…).' : 'Les pièces jointes ne sont pas incluses dans votre licence.')));

      // historique + commentaire
      const cbox = h('textarea.inp', { rows: 2, placeholder: 'Ajouter un commentaire…' });
      const tl = h('div.panel', h('div.panel-h', h('h3', 'Historique')), h('div.panel-b',
        h('div.timeline', f.events.slice().reverse().map((e) => h('div.tl.' + e.type, h('div.d', icon(EV_ICON[e.type] || 'info')), h('div', h('div.m', e.message || e.type), h('div.w', `${e.user_name || 'Système'}, ${F.dt(e.created_at)}`))))),
        h('div.stack.s', { style: { marginTop: '10px' } }, cbox, h('div', h('button.btn.sm', { onclick: async () => { if (!cbox.value.trim()) return; try { await api.post(`/fae/${id}/comment`, { text: cbox.value }); load(); } catch (x) { fail(x); } } }, icon('comment'), 'Commenter')))));

      // points d'attention
      const flags = (f.issues || []).filter((i) => i.level === 'warn' || (f.status === 'draft' || f.status === 'rejected'));
      const flagEl = flags.length ? h('div.notice.warn', icon('alert'), h('div', h('b', f.status === 'in_review' ? 'Points d\'attention pour la validation' : 'Points à traiter'), flags.map((i) => h('div', i.message)))) : null;

      // barre de décision
      const decide = f.can_act ? h('div.decide', h('div', h('b', `Votre visa est attendu : ${pendingStep ? pendingStep.name : ''}`), h('div.small', { style: { color: '#b7c1da' } }, `${f.supplier_name || 'Fournisseur'}, ${F.money(f.final, cur)}`)),
        h('div.row', h('button.btn.danger', { style: { background: '#fff' }, onclick: async () => { const t = await AF.askText('Rejeter la fiche', 'Motif du rejet (transmis à l\'acheteur)', { confirm: 'Rejeter', cls: 'danger', placeholder: 'Ex. joindre la fiche de dérogation, revoir le choix du fournisseur…' }); if (t === null) return; try { await api.post(`/fae/${id}/reject`, { comment: t }); toast('Fiche rejetée : l\'acheteur est alerté.', 'ok'); load(); refreshBadges(); } catch (x) { fail(x); } } }, icon('x'), 'Rejeter'),
          h('button.btn.ok', { onclick: async () => { const t = await AF.askText('Apposer votre visa', 'Commentaire (facultatif)', { required: false, confirm: 'Valider la fiche', cls: 'ok' }); if (t === null) return; try { await api.post(`/fae/${id}/approve`, { comment: t }); toast('Visa apposé.', 'ok'); load(pendingStep && pendingStep.id); refreshBadges(); } catch (x) { fail(x); } } }, icon('check'), 'Valider'))) : null;

      clear(host).append(
        h('div.page-head', h('div', h('a.small', { href: '#/fae' }, 'Toutes les FAE'), h('div.row.wrap', { style: { marginTop: '4px' } }, h('h1', f.number), AF.statusPill(f.status)), h('div.sub', `${f.title || ''}`), h('div.small.muted', `Acheteur : ${f.buyer_name}. Créée le ${F.date(f.created_at)}${f.validated_at ? ', validée le ' + F.date(f.validated_at) : ''}.${f.cycle > 1 ? ' Version ' + f.cycle + '.' : ''}`)), actions),
        rejEv ? h('div.notice.bad.mb', icon('x'), h('div', h('b', `Rejetée par ${rejEv.user_name}`), h('div', rejEv.message))) : null,
        f.status === 'approved' ? h('div.notice.ok.mb', icon('check'), 'Fiche validée par tous les intervenants : vous pouvez poursuivre la commande.') : null,
        h('div.panel.mb', h('div.panel-b', railSteps.length ? AF.rail(railSteps, { stampIdx }) : h('span.muted', 'Aucun circuit défini.'))),
        h('div.split', h('div.stack', kpis, flagEl, secEls, offerEl), h('aside.stack', attach, tl)),
        decide);
    }
    function refreshBadges() { AF.loadBoot().then(() => AF.shell(location.hash.replace(/^#/, '').split('?')[0])).catch(() => {}); }
    await load();
  };
})();
