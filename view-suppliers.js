/* Référentiel fournisseurs : recherche, saisie, import en masse (Excel/CSV) avec aperçu, export. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F, debounce } = AF;

  function editModal(s, after) {
    const f = (v, ph, type) => h('input.inp', { value: v || '', placeholder: ph || '', type: type || 'text' });
    const name = f(s && s.name), ref = f(s && s.ref, 'Ex. code SAP'), country = f(s && s.country), city = f(s && s.city), email = f(s && s.email, 'contact@fournisseur.com; compta@fournisseur.com'), phone = f(s && s.phone, '+225…', 'tel'), cur = f(s && s.currency, 'CFA, EURO, USD…');
    AF.modal({ title: s ? 'Modifier le fournisseur' : 'Nouveau fournisseur', size: 'wide', body: h('div.grid.g2',
      h('div.field', { style: { gridColumn: '1 / -1' } }, h('label', 'Nom du fournisseur', h('span.req', ' *')), name),
      h('div.field', h('label', 'Code fournisseur'), ref), h('div.field', h('label', 'Pays'), country),
      h('div.field', { style: { gridColumn: '1 / -1' } }, h('label', 'E-mails contact'), email, h('div.help', 'Plusieurs adresses possibles, séparées par un point-virgule.')),
      h('div.field', h('label', 'Téléphone'), phone), h('div.field', h('label', 'Ville'), city), h('div.field', h('label', 'Devise'), cur)),
    actions: [{ label: 'Annuler' }, { label: s ? 'Enregistrer' : 'Ajouter', cls: 'primary', onClick: async () => {
      const body = { name: name.value, ref: ref.value, country: country.value, city: city.value, email: email.value, phone: phone.value, currency: cur.value };
      if (s) await api.put('/suppliers/' + s.id, body); else await api.post('/suppliers', body);
      toast('Fournisseur enregistré.', 'ok'); after();
    } }] });
  }

  /** Import en deux temps : 1) analyse et aperçu, 2) confirmation. */
  function importModal(after) {
    let file = null;
    const body = h('div.stack');
    const input = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.txt', hidden: true, onchange: (e) => { if (e.target.files[0]) { file = e.target.files[0]; analyse(); } } });
    const drop = h('div', { style: { border: '2px dashed var(--line)', borderRadius: '8px', padding: '30px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--wash)' },
      onclick: () => input.click(),
      ondragover: (e) => { e.preventDefault(); drop.style.borderColor = 'var(--brand)'; },
      ondragleave: () => { drop.style.borderColor = 'var(--line)'; },
      ondrop: (e) => { e.preventDefault(); drop.style.borderColor = 'var(--line)'; if (e.dataTransfer.files[0]) { file = e.dataTransfer.files[0]; analyse(); } } },
    icon('upload'), h('div', { style: { fontWeight: 650, marginTop: '6px' } }, 'Glissez votre fichier ici ou cliquez pour le choisir'), h('div.help', 'Excel (.xlsx) ou CSV, 20 000 lignes au maximum'));

    function step1() {
      clear(body).append(
        h('div.notice.info', icon('info'), h('div', h('b', 'Colonnes attendues (première ligne = titres)'), h('div', 'Nom fournisseur (obligatoire), Code fournisseur, Pays, E-mails contact. Facultatives : Téléphone, Ville, Devise. L\'ordre des colonnes n\'a pas d\'importance.'))),
        h('div.row.wrap', h('a.btn.sm', { href: '/api/suppliers/template.xlsx' }, icon('download'), 'Télécharger le modèle Excel'), h('span.help', 'Si un code fournisseur (ou à défaut le nom) existe déjà, la ligne met à jour ce fournisseur au lieu de créer un doublon.')),
        drop, input);
    }

    async function analyse() {
      clear(body).append(h('div.spinner'), h('p.center.muted', `Analyse de « ${file.name} »…`));
      const fd = new FormData(); fd.append('file', file); fd.append('mode', 'preview');
      let r;
      try { r = await api.post('/suppliers/import', fd); } catch (e) { step1(); body.prepend(h('div.notice.bad', icon('alert'), e.message)); return; }
      const s = r.summary;
      const tag = (n, l, c) => h('div.kpi', h('div.k', l), h('div.v', { style: { color: c } }, String(n)));
      const colInfo = Object.entries({ name: 'Nom', ref: 'Code', country: 'Pays', email: 'E-mails', phone: 'Téléphone', city: 'Ville', currency: 'Devise' }).map(([k, l]) => h('span.tag' + (r.columns[k] ? '.brand' : ''), `${l} ← ${r.columns[k] || 'absente'}`));
      const st = { new: ['Nouveau', 'approved'], update: ['Mise à jour', 'in_review'], same: ['Déjà à jour', 'draft'], error: ['Rejetée', 'rejected'] };
      clear(body).append(
        h('div.kpi-strip', tag(s.new, 'Nouveaux', 'var(--ok)'), tag(s.update, 'Mis à jour', 'var(--warn)'), tag(s.same, 'Inchangés', 'var(--muted)'), tag(s.error, 'Lignes rejetées', s.error ? 'var(--bad)' : 'var(--muted)')),
        h('div', h('div.lbl', { style: { marginBottom: '6px' } }, 'Colonnes reconnues'), h('div.row.wrap.gap-s', colInfo)),
        h('div.tbl-wrap', { style: { maxHeight: '340px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px' } }, h('table.tbl', h('thead', h('tr', h('th', 'Ligne'), h('th', 'Statut'), h('th', 'Nom'), h('th', 'Code'), h('th', 'Pays'), h('th', 'E-mails'), h('th', 'Remarque'))),
          h('tbody', r.sample.map((l) => h('tr', h('td', String(l.line)), h('td', h('span.pill.' + st[l.status][1], st[l.status][0])), h('td.strong', l.name || '—'), h('td', l.ref), h('td', l.country), h('td.small', l.email), h('td.small', { style: { color: l.status === 'error' ? 'var(--bad)' : 'var(--muted)' } }, l.note)))))),
        s.total > r.sample.length ? h('div.help', `Aperçu des ${r.sample.length} premières lignes sur ${s.total}.`) : null,
        h('div.row.between.wrap', h('button.btn', { onclick: () => { file = null; input.value = ''; step1(); } }, 'Choisir un autre fichier'),
          h('button.btn.primary', { disabled: !(s.new + s.update), onclick: async (e) => {
            e.target.disabled = true;
            const fd2 = new FormData(); fd2.append('file', file); fd2.append('mode', 'commit');
            try {
              const d = await api.post('/suppliers/import', fd2);
              toast(`Import terminé : ${d.summary.new} ajouté(s), ${d.summary.update} mis à jour${d.summary.error ? `, ${d.summary.error} ligne(s) rejetée(s)` : ''}.`, 'ok');
              m.close(); after();
            } catch (x) { fail(x); e.target.disabled = false; }
          } }, icon('check'), `Importer ${s.new + s.update} fournisseur(s)`)));
    }
    step1();
    const m = AF.modal({ title: 'Importer des fournisseurs', size: 'xl', body });
  }

  AF.views.suppliers = async (host) => {
    const st = { q: '', page: 1 };
    const box = h('div'); const stats = h('div.sub');
    const actions = h('div.actionbar');
    async function load() {
      let r; try { r = await api.get('/suppliers?' + AF.qs({ q: st.q, page: st.page })); } catch (e) { return fail(e); }
      stats.textContent = `${F.int(r.stats.count)} fournisseur(s), dont ${F.int(r.stats.with_email)} avec un e-mail de contact`;
      clear(actions).append(
        r.can_edit ? h('button.btn', { onclick: () => importModal(load) }, icon('upload'), 'Importer Excel / CSV') : null,
        h('a.btn', { href: '/api/suppliers/export.xlsx' }, icon('download'), 'Exporter'),
        r.can_edit ? h('button.btn.primary', { onclick: () => editModal(null, load) }, icon('plus'), 'Ajouter') : null);
      const pages = Math.max(1, Math.ceil(r.total / r.per));
      clear(box);
      if (!r.stats.count) {
        box.appendChild(h('div.empty-state', h('h3', 'Aucun fournisseur pour le moment'), h('p', 'Importez votre liste depuis Excel ou CSV : nom, code, pays et e-mails de contact.'),
          r.can_edit ? h('div.row', { style: { justifyContent: 'center' } }, h('a.btn', { href: '/api/suppliers/template.xlsx' }, icon('download'), 'Modèle Excel'), h('button.btn.primary', { onclick: () => importModal(load) }, icon('upload'), 'Importer')) : null));
        return;
      }
      box.append(h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Fournisseur'), h('th', 'Code'), h('th', 'Pays'), h('th', 'E-mails contact'), h('th.hide-m', 'Téléphone'), h('th'))),
        h('tbody', r.rows.map((s) => h('tr', h('td.strong', s.name, s.city ? h('span.sub', s.city) : null), h('td', s.ref || h('span.faint', '—')), h('td', s.country || h('span.faint', '—')),
          h('td.small', s.email ? s.email.split('; ').map((e) => h('div', h('a', { href: 'mailto:' + e }, e))) : h('span.faint', '—')), h('td.hide-m', s.phone || ''),
          h('td.right.nowrap', r.can_edit ? h('button.btn.sm', { onclick: () => editModal(s, load) }, icon('edit'), 'Modifier') : null, ' ',
            r.can_delete ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Supprimer', onclick: async () => { if (await AF.confirmBox('Supprimer ce fournisseur ?', s.name, 'Supprimer', 'danger')) { try { await api.delete('/suppliers/' + s.id); load(); } catch (e) { fail(e); } } } }, icon('trash')) : null)))))),
      h('div.pager', h('span', `${F.int(r.total)} résultat(s)`), h('div.row.gap-s', h('button.btn.sm', { disabled: st.page <= 1, onclick: () => { st.page--; load(); } }, 'Précédent'), h('span', `Page ${st.page} / ${pages}`), h('button.btn.sm', { disabled: st.page >= pages, onclick: () => { st.page++; load(); } }, 'Suivant'))));
    }
    clear(host).append(
      h('div.page-head', h('div', h('h1', 'Fournisseurs'), stats), actions),
      h('div.panel', h('div.filters', h('div.field.grow', h('label', 'Recherche'), h('input.inp', { placeholder: 'Nom, code, pays ou e-mail…', oninput: debounce((e) => { st.q = e.target.value; st.page = 1; load(); }, 300) }))), box));
    await load();
  };
})();
