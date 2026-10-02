/* Connexion, mot de passe oublié, réinitialisation, profil. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast } = AF;

  function art() {
    return h('div.login-art',
      h('div.brand', { style: { padding: 0 } }, h('div.mark', h('i'), h('i'), h('i')), 'AchatFlow'),
      h('div', h('h1', 'De la fiche Excel à la décision d\'achat validée.'),
        h('p', { style: { marginTop: '18px' } }, 'Chaque fiche d\'analyse d\'expression de besoin suit son circuit de visas : l\'acheteur la renseigne, le manager la contrôle, le directeur la valide. Les alertes partent par e-mail et WhatsApp.')),
      AF.rail([{ name: 'Acheteur', state: 'done', sub: 'Fiche soumise' }, { name: 'Manager achats', state: 'done', sub: 'Visa apposé' }, { name: 'Directeur opérationnel', state: 'now', sub: 'À valider' }], { dark: true }));
  }

  AF.views.login = async (host) => {
    const email = h('input.inp', { type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Identifiant ou adresse e-mail' });
    const pwd = h('input.inp', { type: 'password', required: true, autocomplete: 'current-password' });
    const err = h('div.notice.bad', { hidden: true, role: 'alert' });
    const btn = h('button.btn.primary', { type: 'submit', style: { minHeight: '42px' } }, 'Se connecter');
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true; btn.disabled = true;
      try { await api.post('/auth/login', { email: email.value, password: pwd.value }, { quiet401: true }); await AF.loadBoot(); AF._side = null; location.hash = '#/'; AF.navigate(); }
      catch (x) { err.textContent = x.message; err.hidden = false; } finally { btn.disabled = false; }
    } },
    h('div', h('h2', { style: { fontSize: '24px' } }, 'Connexion'), h('p.muted', { style: { marginTop: '4px' } }, 'Accédez à votre espace achats.')),
    err, h('div.field', h('label', 'Identifiant'), email), h('div.field', h('label', 'Mot de passe'), pwd), btn,
    h('a.small', { href: '#/forgot' }, 'Mot de passe oublié ?'));
    clear(host); host.className = '';
    host.appendChild(h('div.login', art(), h('div.login-form', form)));
    email.focus();
  };

  AF.views.forgot = async (host) => {
    const email = h('input.inp', { type: 'email', required: true, placeholder: 'Votre adresse e-mail' });
    const box = h('div');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await api.post('/auth/forgot', { email: email.value }); clear(box).appendChild(h('div.notice.ok', r.message)); } catch (x) { fail(x); } } },
      h('h2', 'Mot de passe oublié'), h('p.muted', 'Saisissez votre adresse : un lien de réinitialisation valable 1 heure vous sera envoyé.'), h('div.field', h('label', 'Adresse e-mail'), email), box,
      h('button.btn.primary', { type: 'submit' }, 'Envoyer le lien'), h('a.small', { href: '#/login' }, 'Retour à la connexion'));
    clear(host); host.appendChild(h('div.login', art(), h('div.login-form', form)));
  };

  AF.views.reset = async (host, { params }) => {
    const pw = h('input.inp', { type: 'password', required: true, autocomplete: 'new-password' });
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); try { await api.post('/auth/reset', { token: params[0], password: pw.value }); toast('Mot de passe modifié. Connectez-vous.', 'ok'); location.hash = '#/login'; } catch (x) { fail(x); } } },
      h('h2', 'Nouveau mot de passe'), h('div.field', h('label', 'Mot de passe'), pw, h('div.help', '8 caractères minimum, avec au moins une lettre et un chiffre.')),
      h('button.btn.primary', { type: 'submit' }, 'Enregistrer'));
    clear(host); host.appendChild(h('div.login', art(), h('div.login-form', form)));
  };

  AF.views.profile = async (host, { query }) => {
    const u = AF.state.user; const b = AF.state.boot;
    const isTenant = !!u.tenant_id;
    const name = h('input.inp', { value: u.name }), phone = h('input.inp', { value: u.phone || '', placeholder: 'Ex. 07 00 00 00 00 ou +225…', inputmode: 'tel' });
    const ne = h('input', { type: 'checkbox', checked: u.notif_email }), nw = h('input', { type: 'checkbox', checked: u.notif_whatsapp }), ni = h('input', { type: 'checkbox', checked: u.notif_inapp });
    const users = (b.users || []).filter((x) => x.id !== u.id && x.active);
    const del = h('select.inp', h('option', { value: '' }, 'Aucune délégation'), users.map((x) => h('option', { value: x.id, selected: x.id === u.delegate_id }, `${x.name} (${b.roles[x.role] || x.role})`)));
    const until = h('input.inp', { type: 'date', value: u.delegate_until || '' });
    const cur = h('input.inp', { type: 'password', autocomplete: 'current-password' }), n1 = h('input.inp', { type: 'password', autocomplete: 'new-password' });
    clear(host).append(
      h('div.page-head', h('div', h('h1', 'Mon profil'), h('div.sub', u.email))),
      query.force ? h('div.notice.warn.mb', icon('alert'), 'Pour votre sécurité, remplacez le mot de passe temporaire avant de continuer.') : null,
      h('div.grid.g2', { style: { alignItems: 'start' } },
        isTenant ? h('div.panel', h('div.panel-h', h('h3', 'Coordonnées et alertes')), h('div.panel-b.stack',
          h('div.field', h('label', 'Nom complet'), name),
          h('div.field', h('label', 'Téléphone WhatsApp'), phone, h('div.help', 'Numéro qui recevra les alertes de validation. Sans indicatif, +225 est appliqué.')),
          h('div.stack.s', h('label.check', ne, 'Recevoir les alertes par e-mail'), h('label.check', nw, 'Recevoir les alertes par WhatsApp'), h('label.check', ni, 'Voir les alertes dans l\'application')),
          AF.is('manager', 'ops_manager', 'director', 'admin') ? h('div.stack.s', h('h4', 'Délégation de validation'), h('div.help', 'Pendant une absence, votre délégué peut valider à votre place.'), h('div.grid.g2', h('div.field', h('label', 'Délégué'), del), h('div.field', h('label', 'Jusqu\'au'), until))) : null,
          h('div', h('button.btn.primary', { onclick: async () => {
            try { await api.put('/me', { name: name.value, phone: phone.value, notif_email: ne.checked, notif_whatsapp: nw.checked, notif_inapp: ni.checked, delegate_id: del ? del.value : '', delegate_until: until.value }); await AF.loadBoot(); toast('Profil enregistré.', 'ok'); } catch (x) { fail(x); } } }, 'Enregistrer')))) : null,
        h('div.panel', h('div.panel-h', h('h3', 'Changer le mot de passe')), h('div.panel-b.stack',
          h('div.field', h('label', 'Mot de passe actuel'), cur), h('div.field', h('label', 'Nouveau mot de passe'), n1, h('div.help', '8 caractères minimum, avec au moins une lettre et un chiffre.')),
          h('div', h('button.btn.primary', { onclick: async () => { try { await api.post('/auth/change-password', { current: cur.value, next: n1.value }); await AF.loadBoot(); toast('Mot de passe modifié.', 'ok'); cur.value = n1.value = ''; if (query.force) location.hash = '#/'; } catch (x) { fail(x); } } }, 'Modifier'))))));
  };
})();
