/* Administration (1/2) : conteneur, utilisateurs, champs de la fiche, listes déroulantes. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F } = AF;
  const A = AF.admin = { tabs: {} };
  const TYPE_LABEL = { text: 'Texte court', textarea: 'Texte long', number: 'Nombre', money: 'Montant', percent: 'Pourcentage', date: 'Date', select: 'Liste déroulante', checkbox: 'Case à cocher', calc: 'Calcul (formule)', pscs: 'Classification PSCS', supplier: 'Fournisseur' };
  const MORE = ['settings', 'lists', 'refs', 'budgets', 'audit'];
  const TITLES = { users: 'Utilisateurs', fields: 'Fiche et champs', workflow: 'Circuit de validation', notifications: 'Alertes e-mail et WhatsApp', license: 'Licence', settings: 'Réglages', lists: 'Listes déroulantes', refs: 'Fournisseurs et nomenclature PSCS', budgets: 'Budgets annuels', audit: 'Journal d\'activité' };
  const locked = (feature) => !AF.has(feature);
  A.lockNote = (feature, text) => (locked(feature) ? h('div.notice.warn.mb', icon('lock'), h('div', text || 'Cette fonction n\'est pas incluse dans votre licence actuelle.', ' ', h('a', { href: '#/admin/license' }, 'Voir les licences'))) : null);

  AF.views.admin = async (host, { params }) => {
    let tab = params[0]; if (tab === 'more') { location.hash = '#/admin/settings'; return; }
    const isMore = MORE.includes(tab);
    const box = h('div');
    clear(host).append(
      h('div.page-head', h('div', h('h1', TITLES[tab]), h('div.sub', 'Administration de ' + AF.state.boot.tenant.name))),
      isMore ? h('div.tabs', MORE.map((k) => h('a' + (k === tab ? '.on' : ''), { href: '#/admin/' + k }, TITLES[k].replace(' et nomenclature PSCS', '')))) : null,
      box);
    box.appendChild(h('div.spinner'));
    const r = await A.tabs[tab](box);
    return typeof r === 'function' ? r : undefined;
  };

  // ── Utilisateurs
  A.tabs.users = async (box) => {
    const r = await api.get('/admin/users');
    const roles = r.roles; const isSelf = (u) => u.id === AF.state.user.id;
    const depts = (AF.state.boot.lists.department || []).map((d) => d.value);
    function edit(u) {
      const name = h('input.inp', { value: u ? u.name : '' }), email = h('input.inp', { type: 'email', value: u ? u.email : '' }), phone = h('input.inp', { value: u ? u.phone || '' : '', placeholder: 'Pour les alertes WhatsApp' });
      const role = h('select.inp', Object.entries(roles).map(([k, l]) => h('option', { value: k, selected: u ? u.role === k : k === 'buyer' }, l)));
      const dept = h('select.inp', h('option', { value: '' }, '—'), depts.map((d) => h('option', { value: d, selected: u && u.department === d }, d)));
      const active = h('input', { type: 'checkbox', checked: u ? u.active : true, disabled: u && isSelf(u) });
      AF.modal({ title: u ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur', body: h('div.grid.g2',
        h('div.field', h('label', 'Nom complet'), name), h('div.field', h('label', 'Adresse e-mail'), email), h('div.field', h('label', 'Rôle'), role), h('div.field', h('label', 'Téléphone WhatsApp'), phone),
        h('div.field', h('label', 'Département'), dept), u ? h('label.check', { style: { alignSelf: 'end', minHeight: '38px' } }, active, 'Compte actif') : null,
        u ? null : h('div.help', { style: { gridColumn: '1 / -1' } }, 'Un mot de passe temporaire est généré et envoyé par e-mail (si l\'envoi est configuré). Il sera à changer à la première connexion.')),
      actions: [{ label: 'Annuler' }, { label: u ? 'Enregistrer' : 'Créer', cls: 'primary', onClick: async () => {
        const body = { name: name.value, email: email.value, role: role.value, phone: phone.value, department: dept.value };
        if (u) { body.active = active.checked; await api.put('/admin/users/' + u.id, body); toast('Utilisateur modifié.', 'ok'); await AF.loadBoot(); A.tabs.users(clear(box)); }
        else { const res = await api.post('/admin/users', body); await AF.loadBoot(); A.tabs.users(clear(box)); showPwd(body.email, res.temp_password); }
      } }] });
    }
    function showPwd(email, pwd) { AF.modal({ title: 'Compte créé', body: h('div.stack', h('p', `Transmettez ces identifiants à l'utilisateur (ils lui sont aussi envoyés par e-mail si le service d'envoi est configuré).`), h('div.code', `${email}\n${pwd}`), h('div.help', 'Ce mot de passe ne sera plus affiché.')), actions: [{ label: 'Copier', cls: 'primary', onClick: async () => { try { await navigator.clipboard.writeText(`${email} / ${pwd}`); toast('Copié.', 'ok'); } catch (e) { /* noop */ } return false; } }, { label: 'Fermer' }] }); }
    const pct = r.max_users ? Math.min(100, (r.used / r.max_users) * 100) : 0;
    clear(box).append(
      h('div.panel.mb', h('div.panel-b.row.between.wrap', h('div', { style: { minWidth: '220px', flex: 1 } }, h('div.row.between', h('b', `${r.used} utilisateur${r.used > 1 ? 's' : ''} actif${r.used > 1 ? 's' : ''}`), h('span.muted', r.max_users ? `sur ${r.max_users} autorisés` : 'illimité')), r.max_users ? h('div.quota', { style: { marginTop: '6px' } }, h('i', { style: { width: pct + '%' } })) : null), h('button.btn.primary', { onclick: () => edit(null) }, icon('plus'), 'Ajouter un utilisateur'))),
      h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Nom'), h('th', 'Rôle'), h('th.hide-m', 'Téléphone'), h('th.hide-m', 'Dernière connexion'), h('th', 'Statut'), h('th'))),
        h('tbody', r.users.map((u) => h('tr', { class: u.active ? '' : 'faint' }, h('td', h('b', u.name), h('span.sub', u.email)), h('td', roles[u.role] || u.role, u.department ? h('span.sub', u.department) : null), h('td.hide-m', u.phone || '—'), h('td.hide-m', u.last_login ? F.dt(u.last_login) : 'Jamais'),
          h('td', u.active ? (u.must_change ? h('span.tag', 'Invitation envoyée') : h('span.pill.approved', 'Actif')) : h('span.pill.cancelled', 'Désactivé')),
          h('td.right.nowrap', h('button.btn.sm', { onclick: () => edit(u) }, icon('edit'), 'Modifier'), ' ', h('button.btn.sm', { title: 'Générer un nouveau mot de passe temporaire', onclick: async () => { if (await AF.confirmBox('Réinitialiser le mot de passe ?', `Un nouveau mot de passe temporaire sera généré pour ${u.name}.`, 'Réinitialiser')) { try { const x = await api.post(`/admin/users/${u.id}/reset-password`); showPwd(u.email, x.temp_password); } catch (e) { fail(e); } } } }, icon('key'))))))))));
  };

  // ── Champs
  A.tabs.fields = async (box) => {
    const state = A.fieldsState = A.fieldsState || { scope: 'fae' };
    const r = await api.get('/admin/fields');
    const custom = r.custom_allowed;
    const secs = r.sections.filter((s) => s.scope === state.scope);
    const fields = r.fields.filter((f) => f.scope === state.scope);
    const bySec = (k) => fields.filter((f) => f.section_key === k).sort((a, b) => a.sort - b.sort);
    const orphans = fields.filter((f) => !secs.some((s) => s.key === f.section_key));

    async function move(list, i, dir) {
      const j = i + dir; if (j < 0 || j >= list.length) return;
      const order = [];
      const copy = list.slice(); [copy[i], copy[j]] = [copy[j], copy[i]];
      secs.forEach((s) => (s.key === copy[0].section_key ? copy : bySec(s.key)).forEach((f) => order.push({ key: f.key, section_key: s.key })));
      try { await api.post('/admin/fields/reorder', { scope: state.scope, items: order }); await AF.loadBoot(); A.tabs.fields(clear(box)); } catch (e) { fail(e); }
    }
    async function patch(f, body) { try { await api.put('/admin/fields/' + f.id, body); await AF.loadBoot(); A.tabs.fields(clear(box)); } catch (e) { fail(e); } }

    function row(f, list, i) {
      const cond = f.visible_if && f.visible_if.field ? ` visible si « ${(r.fields.find((x) => x.key === f.visible_if.field && x.scope === 'fae') || { label: f.visible_if.field }).label} » ${{ eq: '=', ne: '≠', empty: 'est vide', notempty: 'est renseigné', gt: '>', lt: '<' }[f.visible_if.op]} ${f.visible_if.value ?? ''}` : '';
      return h('div.frow' + (f.active ? '' : '.off'),
        h('div.stack.s', { style: { gap: 0 } }, h('button.btn.ghost.icon.sm', { disabled: !custom || i === 0, 'aria-label': 'Monter', onclick: () => move(list, i, -1) }, icon('up')), h('button.btn.ghost.icon.sm', { disabled: !custom || i === list.length - 1, 'aria-label': 'Descendre', onclick: () => move(list, i, 1) }, icon('down'))),
        h('div', h('div.nm', f.label, f.required ? h('span', { style: { color: 'var(--visa)' } }, ' *') : null, ' ', h('span.tag', TYPE_LABEL[f.type] || f.type), f.locked ? null : h('span.tag.brand', { style: { marginLeft: '4px' } }, 'Ajouté')), h('div.meta', [f.type === 'calc' ? `= ${f.formula}` : null, f.type === 'select' && f.list_key ? `Liste : ${f.list_key}` : null, cond].filter(Boolean).join(' ; ') || `Identifiant : ${f.key}`)),
        h('div.row', f.type !== 'calc' ? h('label.row.gap-s.small', 'Obligatoire', AF.boolSwitch(f.required, (v) => patch(f, { required: v }), 'Obligatoire')) : null, h('label.row.gap-s.small', 'Visible', AF.boolSwitch(f.active, (v) => patch(f, { active: v }), 'Visible')),
          h('button.btn.sm', { onclick: () => fieldModal(f) }, icon('edit'), 'Modifier'), !f.locked && custom ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Supprimer', onclick: async () => { if (await AF.confirmBox('Supprimer ce champ ?', `« ${f.label} » ne sera plus proposé. Les valeurs déjà saisies restent conservées dans les fiches existantes.`, 'Supprimer', 'danger')) { try { await api.delete('/admin/fields/' + f.id); await AF.loadBoot(); A.tabs.fields(clear(box)); } catch (e) { fail(e); } } } }, icon('trash')) : null));
    }

    function fieldModal(f, sectionKey) {
      const isNew = !f; const scope = state.scope; const canStructure = custom;
      const v = f ? { ...f } : { type: 'text', width: 2, section_key: sectionKey, required: 0, active: 1 };
      const label = h('input.inp', { value: v.label || '' });
      const type = h('select.inp', { disabled: !isNew, onchange: paintType }, Object.entries(TYPE_LABEL).filter(([k]) => !isNew || !['pscs', 'supplier'].includes(k)).map(([k, l]) => h('option', { value: k, selected: v.type === k }, l)));
      const section = h('select.inp', { disabled: !canStructure }, secs.map((s) => h('option', { value: s.key, selected: v.section_key === s.key }, s.label)));
      const width = h('select.inp', { disabled: !canStructure }, [[1, 'Étroit (1/4)'], [2, 'Moyen (1/2)'], [4, 'Pleine largeur']].map(([k, l]) => h('option', { value: k, selected: Number(v.width) === k }, l)));
      const req = h('input', { type: 'checkbox', checked: !!v.required });
      const help = h('input.inp', { value: v.help || '', placeholder: 'Texte d\'aide affiché sous le champ' });
      const def = h('input.inp', { value: v.default_value || '' });
      const listSel = h('select.inp', h('option', { value: '' }, '— Choisir une liste —'), r.lists.map((l) => h('option', { value: l.key, selected: v.list_key === l.key }, l.label)));
      const formula = h('textarea.inp', { rows: 3, value: v.formula || '', placeholder: 'Ex. {budget} - {amount_final}', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px' } });
      const fmtSel = h('select.inp', [['money', 'Montant'], ['percent', 'Pourcentage'], ['number', 'Nombre'], ['text', 'Texte']].map(([k, l]) => h('option', { value: k, selected: ((v.options || {}).format || 'number') === k }, l)));
      const fchk = h('div.help');
      const vf = v.visible_if || {};
      const vfField = h('select.inp', h('option', { value: '' }, 'Toujours visible'), r.fields.filter((x) => x.scope === 'fae' && x.type !== 'calc' && (!f || x.key !== f.key)).map((x) => h('option', { value: x.key, selected: vf.field === x.key }, x.label)));
      const vfOp = h('select.inp', [['eq', 'est égal à'], ['ne', 'est différent de'], ['notempty', 'est renseigné'], ['empty', 'est vide'], ['gt', 'supérieur à'], ['lt', 'inférieur à']].map(([k, l]) => h('option', { value: k, selected: vf.op === k }, l)));
      const vfVal = h('input.inp', { value: vf.value ?? '', placeholder: 'Valeur' });
      const decimals = h('input.inp', { type: 'number', min: 0, max: 6, value: v.decimals ?? '' });
      const chips = h('div.varchips');
      r.fields.filter((x) => x.scope === scope && x.key !== (f && f.key) && x.type !== 'pscs').forEach((x) => chips.appendChild(h('button', { type: 'button', title: x.label, onclick: () => ins(`{${x.key}}`) }, x.key)));
      const funcs = h('div.varchips', ['IF(cond; oui; non)', 'IFERROR(x; "")', 'AND(', 'OR(', 'ISBLANK(', 'MIN(', 'MAX(', 'ROUND(x; 0)', 'ABS(', ...(scope === 'fae' ? ['RETAINED("champ")', 'MINOFFER("champ")', 'AVGOFFER("champ")', 'COUNTOFFERS()', '{FX}'] : ['{$FX}'])].map((t) => h('button', { type: 'button', onclick: () => ins(t) }, t)));
      function ins(t) { const s = formula.selectionStart ?? formula.value.length; formula.value = formula.value.slice(0, s) + t + formula.value.slice(formula.selectionEnd ?? s); formula.focus(); }
      const dyn = h('div.stack');
      function paintType() {
        const t = type.value; clear(dyn);
        if (t === 'select') dyn.append(h('div.field', h('label', 'Liste de valeurs'), listSel, h('div.help', 'Les valeurs se gèrent dans Autres réglages, Listes déroulantes.')));
        if (t === 'calc') dyn.append(h('div.field', h('label', 'Formule'), formula, h('div.help', 'Utilisez {identifiant} pour un autre champ. Séparez les arguments par ; ou ,.'), chips, funcs, h('div.row', h('button.btn.sm', { type: 'button', onclick: async () => { try { const x = await api.post('/admin/fields/check-formula', { formula: formula.value }); fchk.textContent = x.ok ? 'Formule valide.' : 'Formule invalide : ' + x.error; fchk.style.color = x.ok ? 'var(--ok)' : 'var(--bad)'; } catch (e) { fail(e); } } }, 'Vérifier la formule'), fchk)), h('div.field', h('label', 'Affichage du résultat'), fmtSel));
        if (t === 'number') dyn.append(h('div.field', h('label', 'Décimales'), decimals));
        if (!['calc', 'checkbox'].includes(t)) dyn.append(h('div.field', h('label', 'Valeur par défaut'), def));
      }
      paintType();
      const body = h('div.stack',
        AF.state.boot.license && !custom ? h('div.notice.warn', icon('lock'), 'Votre licence permet de renommer les champs et de changer leur caractère obligatoire. Ajouter des champs, les déplacer ou définir des conditions nécessite l\'option « Champs personnalisés ».') : null,
        h('div.grid.g2', h('div.field', h('label', 'Libellé'), label), h('div.field', h('label', 'Type de champ'), type), scope === 'fae' ? h('div.field', h('label', 'Section'), section) : null, scope === 'fae' ? h('div.field', h('label', 'Largeur'), width) : null),
        dyn, h('div.field', h('label', 'Aide'), help), (isNew || (f && f.type !== 'calc')) ? h('label.check', req, 'Champ obligatoire à la soumission') : null,
        scope === 'fae' && canStructure ? h('div.field', h('label', 'Condition d\'affichage'), h('div.grid.g3', vfField, vfOp, vfVal)) : null);
      AF.modal({ title: isNew ? 'Nouveau champ' : `Champ : ${f.label}`, size: 'wide', body, actions: [{ label: 'Annuler' }, { label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'primary', onClick: async () => {
        const t = type.value;
        const payload = { label: label.value, help: help.value, required: req.checked, section_key: section.value, width: Number(width.value), list_key: listSel.value, formula: formula.value, default_value: def.value, decimals: decimals.value,
          options: t === 'calc' ? { format: fmtSel.value } : undefined, visible_if: scope === 'fae' && canStructure ? (vfField.value ? { field: vfField.value, op: vfOp.value, value: vfVal.value } : null) : undefined };
        if (isNew) await api.post('/admin/fields', { ...payload, scope, type: t }); else await api.put('/admin/fields/' + f.id, payload);
        toast('Champ enregistré.', 'ok'); await AF.loadBoot(); A.tabs.fields(clear(box));
      } }] });
    }

    async function sectionModal(s) {
      const label = h('input.inp', { value: s ? s.label : '' }), color = h('input', { type: 'color', value: s ? s.color : '#2f5d8a', style: { width: '60px', height: '38px' } });
      AF.modal({ title: s ? 'Modifier la section' : 'Nouvelle section', body: h('div.grid.g2', h('div.field', h('label', 'Titre'), label), h('div.field', h('label', 'Couleur'), color)), actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', onClick: async () => { if (s) await api.put('/admin/sections/' + s.id, { label: label.value, color: color.value }); else await api.post('/admin/sections', { label: label.value, color: color.value }); await AF.loadBoot(); A.tabs.fields(clear(box)); } }] });
    }

    clear(box).append(
      A.lockNote('custom_fields', 'Votre licence ne comprend pas les champs personnalisés : seuls le libellé et le caractère obligatoire des champs existants sont modifiables.'),
      h('div.row.between.wrap.mb', h('div.chips', [['fae', 'Fiche (en-tête)'], ['offer', 'Fournisseurs consultés']].map(([k, l]) => h('button.chip' + (state.scope === k ? '.on' : ''), { onclick: () => { state.scope = k; A.tabs.fields(clear(box)); } }, l))),
        h('div.row', state.scope === 'fae' ? h('button.btn', { disabled: !custom, onclick: () => sectionModal(null) }, icon(custom ? 'plus' : 'lock'), 'Section') : null, h('button.btn.primary', { disabled: !custom, onclick: () => fieldModal(null, (secs[0] || {}).key) }, icon(custom ? 'plus' : 'lock'), 'Ajouter un champ'))),
      h('div.notice.info.mb', icon('info'), state.scope === 'fae' ? 'Ces champs composent la fiche. L\'ordre ci-dessous est l\'ordre d\'affichage. Les champs de base servent aux calculs et tableaux de bord : ils peuvent être renommés ou masqués, pas supprimés.' : 'Ces champs sont demandés pour chaque fournisseur consulté (une colonne par fournisseur dans la fiche).'),
      secs.map((s) => { const list = bySec(s.key); return h('section.fsec', { style: { '--sc': s.color } }, h('div.fsec-h', h('span', { style: { flex: 1 } }, s.label), state.scope === 'fae' && custom ? h('button.btn.sm', { onclick: () => sectionModal(s) }, icon('edit'), 'Renommer') : null, custom ? h('button.btn.sm', { onclick: () => fieldModal(null, s.key) }, icon('plus'), 'Champ') : null), list.length ? list.map((f, i) => row(f, list, i)) : h('div.panel-b.muted', 'Aucun champ dans cette section.')); }),
      orphans.length ? h('section.fsec', h('div.fsec-h', 'Sans section'), orphans.map((f, i) => row(f, orphans, i))) : null);
  };

  // ── Listes déroulantes
  A.tabs.lists = async (box) => {
    const r = await api.get('/admin/lists');
    const st = A.listsState = A.listsState || { key: r.lists[0] && r.lists[0].key };
    if (!r.lists.some((l) => l.key === st.key)) st.key = r.lists[0] && r.lists[0].key;
    const cur = r.lists.find((l) => l.key === st.key);
    const custom = AF.has('custom_fields');
    let items = cur ? cur.items.map((i) => ({ ...i })) : [];
    const editor = h('div');
    function paint() {
      clear(editor);
      if (!cur) return;
      const isCur = cur.key === 'currency', isCat = cur.key === 'supplier_category';
      editor.append(h('div.panel', h('div.panel-h', h('h3', cur.label), h('div.row', h('button.btn.sm', { onclick: () => { items.push({ value: '', label: '', meta: {}, active: true }); paint(); } }, icon('plus'), 'Ajouter une valeur'), h('button.btn.primary.sm', { onclick: async () => { try { await api.put('/admin/lists/' + cur.key, { items }); toast('Liste enregistrée.', 'ok'); await AF.loadBoot(); A.tabs.lists(clear(box)); } catch (e) { fail(e); } } }, 'Enregistrer'))),
        isCur ? h('div.panel-b.help', 'Renseignez le taux de conversion vers le CFA de chaque devise. Pour une devise sans taux fixe (ex. USD), laissez vide : l\'acheteur saisit le taux du jour.') : null,
        h('div', items.map((it, i) => h('div.frow', { style: { gridTemplateColumns: '54px minmax(0,1fr) auto' } },
          h('div.stack.s', { style: { gap: 0 } }, h('button.btn.ghost.icon.sm', { disabled: i === 0, 'aria-label': 'Monter', onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; paint(); } }, icon('up')), h('button.btn.ghost.icon.sm', { disabled: i === items.length - 1, 'aria-label': 'Descendre', onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; paint(); } }, icon('down'))),
          h('div.grid', { style: { gridTemplateColumns: isCur ? '1fr 140px' : isCat ? '1fr 2fr' : '1fr' } }, h('input.inp', { value: it.value, placeholder: 'Valeur', oninput: (e) => { it.value = e.target.value; it.label = e.target.value; } }),
            isCur ? h('input.inp.num', { value: it.meta.rate ?? '', placeholder: 'Taux → CFA', inputmode: 'decimal', oninput: (e) => { const n = window.FaeCalc.toNum(e.target.value); it.meta = { ...it.meta, rate: n }; } }) : null,
            isCat ? h('input.inp', { value: it.meta.description || '', placeholder: 'Description affichée sous le champ', oninput: (e) => { it.meta = { ...it.meta, description: e.target.value }; } }) : null),
          h('div.row', h('label.row.gap-s.small', 'Actif', AF.boolSwitch(it.active, (v) => { it.active = v; }, 'Actif')), h('button.btn.ghost.icon.sm', { 'aria-label': 'Retirer', onclick: () => { items.splice(i, 1); paint(); } }, icon('trash')))))),
        !items.length ? h('div.panel-b.muted', 'Liste vide.') : null),
      !cur.system && custom ? h('div.mt', h('button.btn.danger.sm', { onclick: async () => { if (await AF.confirmBox('Supprimer la liste ?', cur.label, 'Supprimer', 'danger')) { try { await api.delete('/admin/lists/' + cur.key); st.key = null; A.tabs.lists(clear(box)); } catch (e) { fail(e); } } } }, icon('trash'), 'Supprimer cette liste')) : null);
    }
    clear(box).append(A.lockNote('custom_fields', 'Vous pouvez modifier le contenu des listes existantes. La création de nouvelles listes nécessite l\'option « Champs personnalisés ».'),
      h('div.admin', { style: { gridTemplateColumns: '230px 1fr' } }, h('div.stack.s', r.lists.map((l) => h('button.btn' + (l.key === st.key ? '.primary' : ''), { style: { justifyContent: 'flex-start' }, onclick: () => { st.key = l.key; A.tabs.lists(clear(box)); } }, l.label)),
        h('button.btn', { disabled: !custom, onclick: async () => { const t = await AF.askText('Nouvelle liste', 'Nom de la liste', { confirm: 'Créer' }); if (t) { try { const x = await api.post('/admin/lists', { label: t }); st.key = x.key; A.tabs.lists(clear(box)); } catch (e) { fail(e); } } } }, icon(custom ? 'plus' : 'lock'), 'Nouvelle liste')), editor));
    paint();
  };
})();
