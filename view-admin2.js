/* Administration (2/2) : circuit de validation, alertes, licence, réglages, référentiels, budgets, journal. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast, F, debounce } = AF;
  const A = AF.admin;
  const NUMERIC = ['final_xof', 'budget_xof', 'initial_xof', 'offers_count'];
  const CANON = { final_xof: 'final_xof', budget_xof: 'budget_xof' };

  // ── Circuit de validation : niveaux et validateurs nommés
  A.tabs.workflow = async (box) => {
    const r = await api.get('/admin/workflow');
    const steps = r.steps.map((s) => ({ ...s, condition: s.condition ? { ...s.condition } : null, approver_type: s.approver_type === 'role' ? 'role' : 'list', validators: (s.validators || []).map((v) => ({ ...v })) }));
    const builder = r.builder;
    const railBox = h('div'); const list = h('div');
    const ROLE_OPTS = Object.entries(r.roles).filter(([k]) => !['buyer', 'viewer'].includes(k));
    function paintRail() {
      const act = steps.filter((s) => s.active);
      clear(railBox).append(AF.rail([{ name: 'Demandeur', state: 'done', sub: 'Soumet la fiche' }, ...act.map((s) => ({ name: (s.name || '').replace(/^Validation\s+/i, ''), state: 'wait', sub: s.approver_type === 'list' ? (s.validators.length ? s.validators.map((v) => v.name || v.email).join(', ') : 'aucun validateur') : `tout ${(r.roles[s.approver_role] || '').toLowerCase()}` }))]));
    }
    function condEditor(s) {
      const c = s.condition || { field: '', op: 'gte', value: '' };
      const fieldSel = h('select.inp', { disabled: !builder, onchange: (e) => { s.condition = e.target.value ? { field: e.target.value, op: NUMERIC.includes(e.target.value) ? 'gte' : 'eq', value: '' } : null; paint(); } }, h('option', { value: '' }, 'Toujours (toutes les fiches)'), Object.entries(r.cond_fields).map(([k, l]) => h('option', { value: k, selected: c.field === k }, l)));
      if (!c.field) return h('div.field', h('label', 'Ce niveau s\'applique'), fieldSel, builder ? null : h('div.help', 'Conditions par montant : licence Business.'));
      const num = NUMERIC.includes(c.field);
      const ops = num ? [['gte', '≥'], ['gt', '>'], ['lte', '≤'], ['lt', '<'], ['eq', '=']] : [['eq', 'est'], ['ne', 'n\'est pas']];
      const opSel = h('select.inp', { onchange: (e) => { s.condition.op = e.target.value; } }, ops.map(([k, l]) => h('option', { value: k, selected: c.op === k }, l)));
      const listKey = { purchase_type: 'purchase_type', spend_nature: 'spend_nature', department: 'department', strategy: 'strategy' }[c.field];
      const val = listKey ? h('select.inp', { onchange: (e) => { s.condition.value = e.target.value; } }, h('option', { value: '' }, '—'), (AF.state.boot.lists[listKey] || []).map((i) => h('option', { value: i.value, selected: c.value === i.value }, i.value))) : h('input.inp' + (num ? '.num' : ''), { value: c.value ?? '', inputmode: num ? 'decimal' : 'text', placeholder: num ? 'Ex. 50 000 000' : '', oninput: (e) => { s.condition.value = num ? window.FaeCalc.toNum(e.target.value) : e.target.value; } });
      return h('div.field', h('label', 'Ce niveau s\'applique seulement si'), h('div.grid', { style: { gridTemplateColumns: '2fr 1fr 2fr' } }, fieldSel, opSel, val));
    }
    function validatorsEditor(s) {
      const rows = h('div.stack.s');
      const paintRows = () => {
        clear(rows);
        if (!s.validators.length) rows.appendChild(h('div.notice.warn', icon('alert'), 'Aucun validateur désigné : ajoutez au moins une personne.'));
        s.validators.forEach((v, k) => rows.appendChild(h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.5fr) minmax(0,1fr) auto', gap: '8px', alignItems: 'center' } },
          h('input.inp', { value: v.name || '', placeholder: 'Nom et prénom', 'aria-label': 'Nom du validateur', oninput: (e) => { v.name = e.target.value; paintRail(); } }),
          h('input.inp', { type: 'email', value: v.email || '', placeholder: 'adresse e-mail', 'aria-label': 'E-mail du validateur', oninput: (e) => { v.email = e.target.value; } }),
          h('input.inp', { type: 'tel', value: v.phone || '', placeholder: 'WhatsApp (ex. 07 00 00 00 00)', 'aria-label': 'Téléphone WhatsApp', oninput: (e) => { v.phone = e.target.value; } }),
          h('button.btn.ghost.icon.sm', { 'aria-label': 'Retirer ce validateur', onclick: () => { s.validators.splice(k, 1); paintRows(); paintRail(); } }, icon('x')))));
      };
      paintRows();
      const existing = h('select.inp', { style: { maxWidth: '280px' }, onchange: (e) => { const u = r.users.find((x) => String(x.id) === e.target.value); if (u && !s.validators.some((v) => String(v.email).toLowerCase() === String(u.email).toLowerCase())) { s.validators.push({ id: u.id, name: u.name, email: u.email, phone: u.phone }); paintRows(); paintRail(); } e.target.value = ''; } },
        h('option', { value: '' }, '+ Choisir un utilisateur existant…'), r.users.filter((u) => u.role !== 'buyer').map((u) => h('option', { value: u.id }, `${u.name} (${r.roles[u.role] || u.role})`)));
      return h('div.stack.s', rows, h('div.row.wrap', h('button.btn.sm', { onclick: () => { s.validators.push({ name: '', email: '', phone: '' }); paintRows(); } }, icon('plus'), 'Ajouter un validateur'), existing),
        h('div.help', 'Chaque validateur reçoit un e-mail' + (r.whatsapp ? ' et un message WhatsApp (si un numéro est renseigné)' : '') + ' dès que la fiche arrive à ce niveau. Un seul visa suffit pour passer au niveau suivant. Une personne qui n\'a pas encore de compte en reçoit un automatiquement, avec ses accès par e-mail.'));
    }
    function paint() {
      paintRail(); clear(list);
      steps.forEach((s, i) => {
        const num = (k) => h('input.inp.num', { type: 'number', min: 0, value: s[k] || 0, oninput: (e) => { s[k] = Number(e.target.value) || 0; } });
        const roleSel = h('select.inp', { onchange: (e) => { s.approver_role = e.target.value; paintRail(); } }, ROLE_OPTS.map(([k, l]) => h('option', { value: k, selected: s.approver_role === k }, l)));
        const escSel = h('select.inp', { onchange: (e) => { s.escalate_role = e.target.value || null; } }, h('option', { value: '' }, '— Aucune —'), ROLE_OPTS.map(([k, l]) => h('option', { value: k, selected: s.escalate_role === k }, l)));
        const mode = h('div.chips', [['list', 'Personnes désignées'], ['role', 'Tout utilisateur d\'un rôle']].map(([k, l]) => h('button.chip' + (s.approver_type === k ? '.on' : ''), { type: 'button', onclick: () => { s.approver_type = k; paint(); } }, l)));
        const more = h('details', { style: { marginTop: '4px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600, color: 'var(--ink-soft)' } }, 'Délais, relances et condition'),
          h('div.grid.g4', { style: { marginTop: '10px' } },
            h('div.field', h('label', 'Délai de réponse (h)'), num('sla_hours'), h('div.help', '0 = sans délai')), h('div.field', h('label', 'Relance toutes les (h)'), num('reminder_hours')),
            h('div.field', h('label', 'Escalade après (h)'), num('escalate_after_hours'), h('div.help', '0 = sans escalade')), h('div.field', h('label', 'Escalader vers'), escSel)),
          h('div', { style: { marginTop: '10px' } }, condEditor(s)));
        list.appendChild(h('div.step-card' + (s.active ? '' : '.off'),
          h('div.top', h('div.n', String(i + 1)), h('input.inp', { value: s.name, style: { fontWeight: 650 }, 'aria-label': 'Nom du niveau', oninput: (e) => { s.name = e.target.value; paintRail(); } }),
            h('label.row.gap-s.small', 'Actif', AF.boolSwitch(s.active, (v) => { s.active = v ? 1 : 0; paint(); }, 'Niveau actif')),
            h('button.btn.ghost.icon.sm', { disabled: i === 0 || !builder, 'aria-label': 'Monter', onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; paint(); } }, icon('up')), h('button.btn.ghost.icon.sm', { disabled: i === steps.length - 1 || !builder, 'aria-label': 'Descendre', onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; paint(); } }, icon('down')),
            builder && steps.length > 1 ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Supprimer le niveau', onclick: () => { steps.splice(i, 1); paint(); } }, icon('trash')) : null),
          h('div', { style: { padding: '14px' } }, h('div.stack',
            h('div.row.wrap.between', h('div.lbl', 'Qui valide à ce niveau ?'), mode),
            s.approver_type === 'list' ? validatorsEditor(s) : h('div.field', { style: { maxWidth: '360px' } }, h('label', 'Rôle'), roleSel, h('div.help', 'Tous les utilisateurs actifs ayant ce rôle sont alertés ; le premier qui répond décide.')),
            s.approver_type === 'list' ? h('div.field', { style: { maxWidth: '360px' } }, h('label', 'Rôle donné aux nouveaux validateurs'), roleSel) : null,
            more))));
      });
    }
    paint();
    async function save(btn) {
      btn.disabled = true;
      try {
        const res = await api.put('/admin/workflow', { steps: steps.map((s) => ({ ...s, validators: s.approver_type === 'list' ? s.validators.filter((v) => (v.email || '').trim() || v.id) : [] })) });
        await AF.loadBoot();
        if (res.created && res.created.length) {
          AF.modal({ title: 'Comptes validateurs créés', size: 'wide', body: h('div.stack', h('p', 'Ces personnes n\'avaient pas encore de compte. Leurs accès leur ont été envoyés par e-mail (si l\'envoi est configuré). Notez-les : les mots de passe ne seront plus affichés.'),
            h('div.code', res.created.map((c) => `${c.name} — ${c.email} — ${c.temp_password}`).join('\n'))), actions: [{ label: 'Fermer', cls: 'primary' }] });
        } else toast('Circuit enregistré. Il s\'applique aux prochaines soumissions.', 'ok');
        A.tabs.workflow(clear(box));
      } catch (e) { fail(e); btn.disabled = false; }
    }
    clear(box).append(
      A.lockNote('workflow_builder', 'Votre licence permet 2 niveaux actifs. Plus de niveaux et les conditions par montant nécessitent la licence Business.'),
      h('div.panel.mb', h('div.panel-h', h('h3', 'Circuit de validation de ' + AF.state.boot.tenant.name)), h('div.panel-b', railBox)),
      list,
      h('div.row.between.wrap', builder ? h('button.btn', { onclick: () => { steps.push({ name: `Niveau ${steps.length + 1}`, approver_type: 'list', approver_role: 'director', validators: [], condition: null, sla_hours: 48, reminder_hours: 24, escalate_after_hours: 0, escalate_role: null, active: 1 }); paint(); } }, icon('plus'), 'Ajouter un niveau') : h('span'),
        h('button.btn.primary', { onclick: (e) => save(e.currentTarget) }, 'Enregistrer le circuit')));
  };

  // ── Alertes
  A.tabs.notifications = async (box) => {
    const [s, log] = await Promise.all([api.get('/admin/settings'), api.get('/admin/notifications')]);
    const ev = JSON.parse(JSON.stringify(s.settings.notifications.events)); const tpl = JSON.parse(JSON.stringify(s.settings.notifications.templates));
    const VARS = ['name', 'number', 'title', 'buyer', 'supplier', 'amount', 'step', 'actor', 'comment', 'hours', 'next', 'link'];
    const cur = { k: Object.keys(s.event_labels)[0] };
    const tplBox = h('div');
    function paintTpl() {
      clear(tplBox); const k = cur.k; const d = s.default_templates[k]; const t = { subject: (tpl[k] || {}).subject || d.subject, body: (tpl[k] || {}).body || d.body, wa: (tpl[k] || {}).wa || d.wa };
      const set = (f) => (e) => { tpl[k] = { ...(tpl[k] || {}), [f]: e.target.value }; };
      const body = h('textarea.inp', { rows: 7, value: t.body, oninput: set('body') });
      tplBox.append(h('div.chips.mb', Object.entries(s.event_labels).map(([key, l]) => h('button.chip' + (key === k ? '.on' : ''), { onclick: () => { cur.k = key; paintTpl(); } }, l))),
        h('div.stack', h('div.field', h('label', 'Objet de l\'e-mail'), h('input.inp', { value: t.subject, oninput: set('subject') })), h('div.field', h('label', 'Corps de l\'e-mail'), body),
          h('div.field', h('label', 'Message WhatsApp'), h('input.inp', { value: t.wa, oninput: set('wa') }), h('div.help', 'Avec Meta Cloud API, ce texte remplit une variable du modèle de message approuvé par WhatsApp.')),
          h('div.field', h('label', 'Variables disponibles'), h('div.varchips', VARS.map((v) => h('button', { type: 'button', onclick: () => { body.value += `{${v}}`; body.dispatchEvent(new Event('input')); } }, `{${v}}`)))),
          h('div', h('button.btn.sm', { onclick: () => { delete tpl[k]; paintTpl(); } }, 'Rétablir le texte d\'origine'))));
    }
    paintTpl();
    const stateTag = (ok, l) => h('span.pill.' + (ok ? 'approved' : 'draft'), l);
    clear(box).append(
      h('div.panel.mb', h('div.panel-b.row.between.wrap', h('div.row.wrap.gap-l', h('div', h('b', 'E-mail'), ' ', stateTag(s.channels.smtp, s.channels.smtp ? 'Configuré (' + s.channels.email.provider + ')' : 'Non configuré')), h('div', h('b', 'WhatsApp'), ' ', stateTag(s.channels.whatsapp && s.whatsapp_allowed, !s.whatsapp_allowed ? 'Hors licence' : s.channels.whatsapp ? 'Configuré (' + s.channels.whatsapp_provider + ')' : 'Non configuré'))),
        h('div.row', h('button.btn.sm', { onclick: async () => { try { await api.post('/admin/notifications/test', { channel: 'email' }); toast('E-mail de test envoyé à votre adresse.', 'ok'); } catch (e) { fail(e); } } }, icon('mail'), 'Tester l\'e-mail'), h('button.btn.sm', { onclick: async () => { try { await api.post('/admin/notifications/test', { channel: 'whatsapp' }); toast('Message WhatsApp de test mis en file.', 'ok'); } catch (e) { fail(e); } } }, icon('chat'), 'Tester WhatsApp')))),
      (!s.channels.smtp || !s.channels.whatsapp) ? h('div.notice.warn.mb', icon('alert'), h('div.stack.s',
        h('b', 'Pourquoi les messages ne partent pas'),
        !s.channels.smtp ? h('div', 'E-mail : la variable ' + s.channels.email.missing + ' manque chez l\'hébergeur. Sur l\'offre gratuite de Render, les ports SMTP sont bloqués : utilisez Brevo (EMAIL_PROVIDER=brevo, BREVO_API_KEY, EMAIL_FROM) qui passe par HTTPS.') : null,
        !s.channels.whatsapp ? h('div', 'WhatsApp : la variable ' + s.channels.wa.missing + ' manque. Il faut un compte Meta Business avec un numéro et un modèle de message approuvés (ou un compte Twilio).') : null,
        h('div.help', 'En attendant, les alertes restent visibles dans la cloche de l\'application et le journal ci-dessous indique « Non configuré ».'))) : null,
      h('div.grid.g2', { style: { alignItems: 'start' } },
        h('div.panel', h('div.panel-h', h('h3', 'Quels événements alertent, et par quel canal ?')), h('div.panel-b', h('div.evgrid', h('div.h', 'Événement'), h('div.h', 'E-mail'), h('div.h', 'WhatsApp'), h('div.h', 'Appli'),
          Object.entries(s.event_labels).map(([k, l]) => [h('div', l), ...['email', 'whatsapp', 'inapp'].map((c) => h('div.c', AF.boolSwitch(ev[k][c], (v) => { ev[k][c] = v; }, `${l} ${c}`)))])), h('div.help.mt', 'Chaque utilisateur peut aussi couper un canal dans son profil.'))),
        h('div.panel', h('div.panel-h', h('h3', 'Textes des messages')), h('div.panel-b', tplBox))),
      h('div.mt', h('button.btn.primary', { onclick: async () => { try { await api.put('/admin/settings', { settings: { notifications: { events: ev, templates: tpl } } }); toast('Réglages des alertes enregistrés.', 'ok'); await AF.loadBoot(); } catch (e) { fail(e); } } }, 'Enregistrer les alertes')),
      h('div.panel.mt-l', h('div.panel-h', h('h3', 'Derniers envois')), h('div.tbl-wrap', log.rows.length ? h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'Canal'), h('th', 'Destinataire'), h('th', 'Objet'), h('th', 'Statut'))),
        h('tbody', log.rows.map((n) => h('tr', h('td.nowrap', F.dt(n.created_at)), h('td', n.channel === 'email' ? 'E-mail' : 'WhatsApp'), h('td', n.user_name || n.recipient, h('span.sub', n.recipient)), h('td', n.subject), h('td', h('span.pill.' + (n.status === 'sent' ? 'approved' : n.status === 'failed' ? 'rejected' : 'draft'), { title: n.error || '' }, { sent: 'Envoyé', failed: 'Échec', simulated: 'Non configuré', queued: 'En file' }[n.status] || n.status)))))) : h('div.panel-b.muted', 'Aucun envoi pour le moment.'))));
  };

  // ── Licence
  A.tabs.license = async (box) => {
    const l = await api.get('/admin/license');
    const key = h('textarea.inp', { rows: 3, placeholder: 'AF1.xxxxxxxx.xxxxxxxx', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px' } });
    const stateMap = { active: ['approved', 'Active'], expiring: ['in_review', 'Expire bientôt'], grace: ['rejected', 'Expirée (période de grâce)'], expired: ['rejected', 'Expirée : lecture seule'], suspended: ['rejected', 'Suspendue'] };
    const [sc, sl] = stateMap[l.state] || ['draft', l.state];
    const q = (used, max, label) => h('div', h('div.row.between', h('span', label), h('b', max ? `${used} / ${max}` : `${used} (illimité)`)), max ? h('div.quota', { style: { marginTop: '5px' } }, h('i', { style: { width: Math.min(100, (used / max) * 100) + '%' } })) : null);
    const feats = Object.entries(l.all_features);
    clear(box).append(
      h('div.grid.g2', { style: { alignItems: 'start' } },
        h('div.panel', h('div.panel-b.stack', h('div.row.between', h('h2', 'Licence ' + l.plan_label), h('span.pill.' + sc, sl)), h('div.muted', l.expires_at ? `Échéance : ${F.date(l.expires_at)}${l.daysLeft != null ? ' (' + (l.daysLeft >= 0 ? `dans ${l.daysLeft} jours` : `dépassée de ${-l.daysLeft} jours`) + ')' : ''}` : 'Sans échéance'),
          q(l.used_users, l.max_users, 'Utilisateurs actifs'), l.max_fae_month ? h('div.muted.small', `${l.max_fae_month} nouvelles FAE par mois maximum.`) : h('div.muted.small', 'Volume de FAE illimité.'),
          h('div', h('div.lbl', { style: { marginBottom: '6px' } }, 'Fonctions incluses'), h('div.stack.s', feats.map(([k, name]) => h('div.row', icon(l.features.includes(k) ? 'check' : 'lock'), h('span', { style: { color: l.features.includes(k) ? 'var(--ink)' : 'var(--faint)' } }, name))))))),
        h('div.panel', h('div.panel-h', h('h3', 'Activer une clé de licence')), h('div.panel-b.stack', h('p.muted', 'Collez la clé reçue de votre fournisseur pour renouveler ou faire évoluer votre licence. Elle est liée à votre compte client.'), key,
          h('div', h('button.btn.primary', { onclick: async () => { try { await api.post('/admin/license/activate', { key: key.value }); toast('Licence mise à jour.', 'ok'); await AF.loadBoot(); A.tabs.license(clear(box)); } catch (e) { fail(e); } } }, icon('key'), 'Activer')))))
      ,
      h('h3.mt-l.mb', 'Formules disponibles'),
      h('div.grid.g3', Object.entries(l.plans).map(([k, p]) => h('div.plan' + (k === l.plan ? '.cur' : ''), h('h3', p.label), h('div.muted.small', p.hint), h('ul', h('li', `${p.max_users} utilisateurs`), h('li', p.max_fae_month ? `${p.max_fae_month} FAE par mois` : 'FAE illimitées'), p.features.map((f) => h('li', l.all_features[f]))), k === l.plan ? h('span.tag.brand', 'Votre formule') : null))));
  };

  // ── Réglages généraux
  A.tabs.settings = async (box) => {
    const r = await api.get('/admin/settings'); const s = r.settings; const c = s.controls;
    const name = h('input.inp', { value: r.name }), color = h('input', { type: 'color', value: r.brand_color, style: { width: '60px', height: '38px' } });
    const prefix = h('input.inp', { value: s.number_prefix, maxlength: 8 }), maxo = h('input.inp', { type: 'number', min: 1, max: 12, value: s.max_offers });
    const see = h('input', { type: 'checkbox', checked: s.shared_view !== false });
    const mode = (v) => h('select.inp', [['off', 'Désactivé'], ['warn', 'Avertir'], ['block', 'Bloquer la soumission']].map(([k, l]) => h('option', { value: k, selected: v === k }, l)));
    const mo = h('input.inp', { type: 'number', min: 1, value: c.min_offers }), mm = mode(c.min_offers_mode), ob = mode(c.over_budget_mode);
    const bn = h('input', { type: 'checkbox', checked: c.block_nonconform !== false }), rj = h('input', { type: 'checkbox', checked: c.require_justification_not_lowest !== false });
    clear(box).append(h('div.grid.g2', { style: { alignItems: 'start' } },
      h('div.panel', h('div.panel-h', h('h3', 'Identité et numérotation')), h('div.panel-b.stack', h('div.field', h('label', 'Nom de l\'entreprise'), name), h('div.field', h('label', 'Couleur de l\'interface'), color),
        h('div.grid.g2', h('div.field', h('label', 'Préfixe des numéros'), prefix, h('div.help', 'Ex. FAE donne FAE-2026-0001')), h('div.field', h('label', 'Fournisseurs consultés maximum'), maxo)),
        h('label.check', see, 'Vue partagée : tous les utilisateurs de l\'entreprise voient toutes les FAE et le même tableau de bord'))),
      h('div.panel', h('div.panel-h', h('h3', 'Contrôles du processus d\'achat')), h('div.panel-b.stack',
        h('div.grid.g2', h('div.field', h('label', 'Nombre minimal de fournisseurs consultés'), mo), h('div.field', h('label', 'Si moins que ce minimum'), mm), h('div.field', h('label', 'Si le montant final dépasse le budget'), ob)),
        h('label.check', bn, 'Bloquer si le fournisseur retenu n\'est pas techniquement conforme'), h('label.check', rj, 'Exiger une justification si le retenu n\'est pas le moins-disant conforme'),
        h('div.help', 'Ces contrôles s\'affichent en direct dans la fiche et à la soumission.')))),
      h('div.mt', h('button.btn.primary', { onclick: async () => { try { await api.put('/admin/settings', { name: name.value, brand_color: color.value, settings: { number_prefix: prefix.value, max_offers: maxo.value, shared_view: see.checked, controls: { min_offers: mo.value, min_offers_mode: mm.value, over_budget_mode: ob.value, block_nonconform: bn.checked, require_justification_not_lowest: rj.checked } } }); toast('Réglages enregistrés.', 'ok'); await AF.loadBoot(); AF.shell(location.hash.replace(/^#/, '')); } catch (e) { fail(e); } } }, 'Enregistrer')));
  };

  // ── Fournisseurs et PSCS
  A.tabs.refs = async (box) => {
    const st = { q: '', page: 1, pq: '' };
    const supBox = h('div'), pBox = h('div');
    async function loadSup() {
      const r = await api.get('/admin/suppliers?' + AF.qs({ q: st.q, page: st.page }));
      const delBtn = (x) => h('button.btn.ghost.icon.sm', { 'aria-label': 'Supprimer', onclick: async () => { if (await AF.confirmBox('Supprimer ce fournisseur ?', x.name, 'Supprimer', 'danger')) { try { await api.delete('/admin/suppliers/' + x.id); loadSup(); } catch (e) { fail(e); } } } }, icon('trash'));
      const head = h('thead', h('tr', h('th', 'Code'), h('th', 'Fournisseur'), h('th', 'Ville'), h('th', 'Pays'), h('th', 'Devise'), h('th')));
      const body = h('tbody', r.rows.map((x) => h('tr', h('td', x.ref || ''), h('td.strong', x.name), h('td', x.city || ''), h('td', x.country || ''), h('td', x.currency || ''), h('td.right', delBtn(x)))));
      const pages = Math.max(1, Math.ceil(r.total / 50));
      const pager = h('div.pager', h('span', r.total + ' fournisseur(s)'), h('div.row.gap-s', h('button.btn.sm', { disabled: st.page <= 1, onclick: () => { st.page--; loadSup(); } }, 'Précédent'), h('span', 'Page ' + st.page + ' / ' + pages), h('button.btn.sm', { disabled: st.page >= pages, onclick: () => { st.page++; loadSup(); } }, 'Suivant')));
      clear(supBox).append(h('div.tbl-wrap', h('table.tbl', head, body)), pager);
    }
    async function loadP() { const r = await api.get('/admin/pscs?' + AF.qs({ q: st.pq })); clear(pBox).append(h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Code'), h('th', 'Niveau'), h('th', 'Libellé'))), h('tbody', r.rows.map((x) => h('tr', h('td.strong', x.code), h('td', x.level), h('td', x.long_name || x.short_name))))), h('div.pager', h('span', `${r.total} lignes dans la nomenclature (100 affichées au plus)`)))); }
    const upload = (url, after, extra) => { const f = h('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async (e) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); if (extra) Object.entries(extra()).forEach(([k, v]) => fd.append(k, v)); try { const r = await api.post(url, fd); toast(`${r.added} ligne(s) importée(s)${r.skipped ? `, ${r.skipped} déjà présente(s)` : ''}.`, 'ok'); after(); } catch (x) { fail(x); } e.target.value = ''; } }); return h('span', f, h('button.btn.sm', { onclick: () => f.click() }, icon('upload'), 'Importer un fichier Excel')); };
    const addSup = () => { const n = h('input.inp'), ref = h('input.inp'), city = h('input.inp'), country = h('input.inp'), cur = h('input.inp', { placeholder: 'EUR, USD, CFA…' });
      AF.modal({ title: 'Nouveau fournisseur', body: h('div.grid.g2', h('div.field', { style: { gridColumn: '1 / -1' } }, h('label', 'Nom'), n), h('div.field', h('label', 'Code'), ref), h('div.field', h('label', 'Devise'), cur), h('div.field', h('label', 'Ville'), city), h('div.field', h('label', 'Pays'), country)), actions: [{ label: 'Annuler' }, { label: 'Ajouter', cls: 'primary', onClick: async () => { await api.post('/admin/suppliers', { name: n.value, ref: ref.value, city: city.value, country: country.value, currency: cur.value }); loadSup(); } }] }); };
    clear(box).append(
      h('div.notice.info.mb', icon('info'), h('div', 'Pour importer vos fournisseurs en masse (Excel ou CSV avec e-mails de contact), utilisez la page ', h('a', { href: '#/suppliers' }, 'Fournisseurs'), ' du menu principal.')),
      h('div.panel.mb', h('div.panel-h', h('h3', 'Fournisseurs'), h('div.row', h('input.inp', { placeholder: 'Rechercher…', style: { width: '200px' }, oninput: debounce((e) => { st.q = e.target.value; st.page = 1; loadSup(); }, 300) }), h('button.btn.sm', { onclick: addSup }, icon('plus'), 'Ajouter'), upload('/admin/suppliers/import', loadSup))), supBox,
        h('div.panel-b.help', 'Import Excel : première ligne = en-têtes. Colonnes reconnues : Nom (obligatoire), Code, Pays, Ville, Devise. Les doublons sont ignorés.')),
      h('div.panel', h('div.panel-h', h('h3', 'Nomenclature d\'achats (PSCS)'), h('div.row', h('input.inp', { placeholder: 'Rechercher…', style: { width: '200px' }, oninput: debounce((e) => { st.pq = e.target.value; loadP(); }, 300) }), upload('/admin/pscs/import', loadP))), pBox,
        h('div.panel-b.help', 'Import Excel : colonnes Code et Libellé obligatoires ; Niveau, Libellé long et Description facultatives. Les codes existants sont conservés.')));
    loadSup(); loadP();
  };

  // ── Budgets
  A.tabs.budgets = async (box) => {
    const st = A.budgetYear = A.budgetYear || new Date().getFullYear();
    if (!AF.has('budgets')) { clear(box).append(A.lockNote('budgets', 'Le suivi budgétaire annuel n\'est pas inclus dans votre licence.')); return; }
    const r = await api.get('/admin/budgets?year=' + st);
    const rows = r.items.map((i) => ({ ...i }));
    clear(box).append(
      h('div.row.between.wrap.mb', h('div.row', h('label.lbl', 'Année'), h('input.inp', { type: 'number', value: st, style: { width: '110px' }, onchange: (e) => { A.budgetYear = Number(e.target.value); A.tabs.budgets(clear(box)); } })), h('button.btn.primary', { onclick: async () => { try { await api.put('/admin/budgets', { year: r.year, items: rows }); toast('Budgets enregistrés.', 'ok'); } catch (e) { fail(e); } } }, 'Enregistrer')),
      h('div.notice.info.mb', icon('info'), 'Saisissez l\'enveloppe annuelle de chaque département en CFA. Le tableau de bord la compare aux fiches validées et en cours.'),
      h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Département'), h('th.num', 'Budget annuel (CFA)'), h('th.num', 'Engagé'), h('th', 'Consommation'))),
        h('tbody', rows.map((x) => { const pct = x.amount_xof ? x.consumed / x.amount_xof : 0; return h('tr', h('td.strong', x.department), h('td.num', h('input.inp.num', { value: x.amount_xof ? F.int(x.amount_xof) : '', inputmode: 'numeric', style: { maxWidth: '180px' }, oninput: (e) => { x.amount_xof = window.FaeCalc.toNum(e.target.value) || 0; } })), h('td.num', F.int(x.consumed)), h('td', { style: { minWidth: '160px' } }, x.amount_xof ? h('div.row', h('div.quota.grow', h('i', { style: { width: Math.min(100, pct * 100) + '%', background: pct > 1 ? 'var(--bad)' : pct > .85 ? 'var(--warn)' : 'var(--brand)' } })), h('span.small', F.pct(pct, 0))) : h('span.faint', '—'))); }))))));
  };

  // ── Journal
  A.tabs.audit = async (box) => {
    const r = await api.get('/admin/audit');
    clear(box).append(h('div.panel', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'Utilisateur'), h('th', 'Action'), h('th', 'Détail'))), h('tbody', r.rows.map((x) => h('tr', h('td.nowrap', F.dt(x.created_at)), h('td', x.user_name || 'Système'), h('td', h('span.tag', x.action)), h('td.small', { style: { maxWidth: '420px', overflowWrap: 'anywhere' } }, [x.entity, x.entity_id].filter(Boolean).join(' ') + (x.detail && x.detail !== '{}' ? ' ' + x.detail : ''))))))))); 
  };
})();
