/* Console éditeur : clients, licences, suspension. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F } = AF;

  AF.views.superConsole = async (host) => {
    const box = h('div');
    clear(host).append(h('div.page-head', h('div', h('h1', 'Clients et licences'), h('div.sub', 'Console de l\'éditeur'))), box);
    async function load() {
      const r = await api.get('/super/tenants');
      const stMap = { active: ['approved', 'Active'], expiring: ['in_review', 'Expire bientôt'], grace: ['rejected', 'Grâce'], expired: ['rejected', 'Expirée'], suspended: ['rejected', 'Suspendue'] };
      clear(box).append(
        h('div.row.between.wrap.mb', h('div.muted', `${r.tenants.length} client${r.tenants.length > 1 ? 's' : ''}`), h('button.btn.primary', { onclick: () => create(r) }, icon('plus'), 'Nouveau client')),
        h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Client'), h('th', 'Formule'), h('th', 'Licence'), h('th', 'Échéance'), h('th.num', 'Utilisateurs'), h('th.num', 'FAE (mois / total)'), h('th'))),
          h('tbody', r.tenants.map((t) => { const [c, l] = t.status === 'suspended' ? ['rejected', 'Compte suspendu'] : (stMap[t.license_state] || ['draft', t.license_state]); return h('tr', h('td', h('b', t.name), h('span.sub', t.slug)), h('td', (r.plans[t.plan] || {}).label || t.plan), h('td', h('span.pill.' + c, l)), h('td.nowrap', F.date(t.expires_at)), h('td.num', `${t.users}${t.max_users ? ' / ' + t.max_users : ''}`), h('td.num', `${t.fae_month} / ${t.fae_total}`), h('td.right.nowrap', h('button.btn.sm', { onclick: () => usersModal(t) }, icon('users'), 'Utilisateurs'), ' ', h('button.btn.sm', { onclick: () => edit(t, r) }, icon('edit'), 'Licence'))); }))))));
    }

    /** Utilisateurs d'une entreprise cliente : création, rôle, activation, mot de passe, vue partagée. */
    async function usersModal(t) {
      const body = h('div.stack');
      const showPwd = (email, pwd) => AF.modal({ title: 'Accès à transmettre', body: h('div.stack', h('p', 'Ce mot de passe temporaire ne sera plus affiché. L\'utilisateur devra le changer à sa première connexion.'), h('div.code', `${email}\n${pwd}`)), actions: [{ label: 'Fermer', cls: 'primary' }] });
      async function paint() {
        let d; try { d = await api.get(`/super/tenants/${t.id}/users`); } catch (e) { return fail(e); }
        const roleSel = (cur, onch) => h('select.inp', { onchange: (e) => onch(e.target.value), style: { minWidth: '170px' } }, Object.entries(d.roles).map(([k, l]) => h('option', { value: k, selected: cur === k }, l)));
        const name = h('input.inp', { placeholder: 'Nom et prénom' }), email = h('input.inp', { type: 'email', placeholder: 'adresse e-mail' }), phone = h('input.inp', { placeholder: 'WhatsApp (facultatif)' });
        let newRole = 'buyer'; const nr = roleSel('buyer', (v) => { newRole = v; });
        clear(body).append(
          h('div.panel', h('div.panel-b.row.between.wrap', h('div', { style: { flex: 1, minWidth: '240px' } }, h('b', 'Vue partagée'), h('div.help', 'Tous les utilisateurs de l\'entreprise voient toutes les fiches et le même tableau de bord.')),
            AF.boolSwitch(d.shared_view, async (v) => { try { await api.put(`/super/tenants/${t.id}/settings`, { shared_view: v }); toast('Réglage enregistré.', 'ok'); } catch (e) { fail(e); } }, 'Vue partagée'))),
          h('div.panel', h('div.panel-h', h('h3', 'Ajouter un utilisateur'), h('span.small.muted', d.license.max_users ? `${d.users.filter((u) => u.active).length} / ${d.license.max_users} utilisateurs actifs` : '')),
            h('div.panel-b.grid', { style: { gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr auto', gap: '8px', alignItems: 'end' } }, name, email, phone, nr,
              h('button.btn.primary', { onclick: async () => { try { const x = await api.post(`/super/tenants/${t.id}/users`, { name: name.value, email: email.value, phone: phone.value, role: newRole }); showPwd(email.value.trim().toLowerCase(), x.temp_password); paint(); load(); } catch (e) { fail(e); } } }, icon('plus'), 'Ajouter'))),
          h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Utilisateur'), h('th', 'Rôle'), h('th', 'Téléphone'), h('th', 'Actif'), h('th'))),
            h('tbody', d.users.map((u) => h('tr', h('td', h('b', u.name), h('span.sub', u.email)),
              h('td', roleSel(u.role, async (v) => { try { await api.put(`/super/tenants/${t.id}/users/${u.id}`, { role: v }); toast('Rôle modifié.', 'ok'); } catch (e) { fail(e); paint(); } })),
              h('td', u.phone || h('span.faint', '—')),
              h('td', AF.boolSwitch(u.active, async (v) => { try { await api.put(`/super/tenants/${t.id}/users/${u.id}`, { active: v }); toast(v ? 'Compte activé.' : 'Compte désactivé.', 'ok'); load(); } catch (e) { fail(e); paint(); } }, 'Actif')),
              h('td.right', h('button.btn.sm', { title: 'Nouveau mot de passe temporaire', onclick: async () => { if (await AF.confirmBox('Réinitialiser le mot de passe ?', u.name, 'Réinitialiser')) { try { const x = await api.post(`/super/tenants/${t.id}/users/${u.id}/reset-password`); showPwd(u.email, x.temp_password); } catch (e) { fail(e); } } } }, icon('key'), 'Mot de passe'))))))))); 
      }
      AF.modal({ title: `Utilisateurs de ${t.name}`, size: 'xl', body });
      body.appendChild(h('div.spinner')); paint();
    }
    function planFields(r, t) {
      const plan = h('select.inp', Object.entries(r.plans).map(([k, p]) => h('option', { value: k, selected: t ? t.plan === k : k === 'business' }, p.label)));
      const users = h('input.inp', { type: 'number', min: 1, value: t ? t.max_users : '', placeholder: 'Selon la formule' });
      const fae = h('input.inp', { type: 'number', min: 0, value: t ? t.max_fae_month : '', placeholder: '0 = illimité' });
      const feats = Object.entries(r.features).map(([k, l]) => ({ k, l, cb: h('input', { type: 'checkbox', checked: t ? t.features.includes(k) : (r.plans[plan.value].features || []).includes(k) }) }));
      plan.addEventListener('change', () => { feats.forEach((f) => { f.cb.checked = r.plans[plan.value].features.includes(f.k); }); users.value = r.plans[plan.value].max_users; fae.value = r.plans[plan.value].max_fae_month; });
      return { plan, users, fae, feats, node: h('div.stack', h('div.grid.g3', h('div.field', h('label', 'Formule'), plan), h('div.field', h('label', 'Utilisateurs max.'), users), h('div.field', h('label', 'FAE / mois'), fae)), h('div.field', h('label', 'Fonctions incluses (modifiable à la carte)'), h('div.grid.g2', feats.map((f) => h('label.check', f.cb, f.l))))) };
    }
    function create(r) {
      const name = h('input.inp'), an = h('input.inp'), ae = h('input.inp', { type: 'email' }), ap = h('input.inp', { placeholder: 'WhatsApp de l\'administrateur' }), months = h('input.inp', { type: 'number', min: 1, value: 12 });
      const pf = planFields(r, null);
      const lp = h('input', { type: 'checkbox' }), ls = h('input', { type: 'checkbox' });
      AF.modal({ title: 'Nouveau client', size: 'wide', body: h('div.stack', h('div.grid.g2', h('div.field', h('label', 'Nom de l\'entreprise'), name), h('div.field', h('label', 'Durée de la licence (mois)'), months), h('div.field', h('label', 'Administrateur : nom'), an), h('div.field', h('label', 'Administrateur : e-mail'), ae), h('div.field', h('label', 'Téléphone'), ap)), pf.node,
        h('div.field', h('label', 'Données de départ (facultatif)'), h('label.check', lp, 'Précharger la nomenclature d\'achats PSCS'), h('label.check', ls, 'Précharger la base de fournisseurs'), h('div.help', 'À ne cocher que pour le client dont ces données sont issues : ne jamais transmettre la base fournisseurs d\'un client à un autre. Sinon, le client les importe depuis Excel.')),
        h('div.help', 'Le compte est créé avec la fiche standard. Un mot de passe temporaire est envoyé à l\'administrateur.')),
      actions: [{ label: 'Annuler' }, { label: 'Créer le client', cls: 'primary', onClick: async () => {
        const res = await api.post('/super/tenants', { name: name.value, admin_name: an.value, admin_email: ae.value, admin_phone: ap.value, months: months.value, plan: pf.plan.value, max_users: pf.users.value, max_fae_month: pf.fae.value, load_pscs: lp.checked, load_suppliers: ls.checked, features: pf.feats.filter((f) => f.cb.checked).map((f) => f.k) });
        await load(); AF.modal({ title: 'Client créé', body: h('div.stack', h('p', 'Transmettez ces accès à l\'administrateur du client :'), h('div.code', `${ae.value}\n${res.temp_password}`)), actions: [{ label: 'Fermer', cls: 'primary' }] });
      } }] });
    }
    function edit(t, r) {
      const pf = planFields(r, t); const ext = h('input.inp', { type: 'number', min: 0, placeholder: 'Mois à ajouter', value: '' });
      const key = h('div.code', t.license_key || '—');
      AF.modal({ title: t.name, size: 'wide', body: h('div.stack', pf.node, h('div.field', h('label', 'Prolonger la licence de (mois)'), ext, h('div.help', `Échéance actuelle : ${F.date(t.expires_at) || 'aucune'}`)), h('div.field', h('label', 'Clé de licence en vigueur'), key, h('div.help', 'Le client peut aussi la coller dans Administration, Licence.'))),
        actions: [{ label: t.status === 'suspended' ? 'Réactiver le compte' : 'Suspendre le compte', cls: t.status === 'suspended' ? '' : 'danger', onClick: async () => { await api.put('/super/tenants/' + t.id, { status: t.status === 'suspended' ? 'active' : 'suspended' }); toast('Statut modifié.', 'ok'); load(); } }, { label: 'Fermer' },
          { label: 'Enregistrer', cls: 'primary', onClick: async () => { await api.put('/super/tenants/' + t.id, { plan: pf.plan.value, max_users: pf.users.value, max_fae_month: pf.fae.value, features: pf.feats.filter((f) => f.cb.checked).map((f) => f.k), extend_months: ext.value || undefined }); toast('Licence mise à jour.', 'ok'); load(); } }] });
    }
    await load();
  };
})();
