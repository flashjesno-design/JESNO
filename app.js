/* AchatFlow — coquille (menu latéral), enregistrement des routes, démarrage. */
(function () {
  'use strict';
  const { h, icon, clear, api, fail, toast } = AF;

  AF.shell = function (path) {
    const root = document.getElementById('app');
    const b = AF.state.boot, u = AF.state.user;
    let page = document.getElementById('page');
    if (!page || !document.getElementById('shell')) {
      clear(root);
      const side = h('aside.side#side');
      const scrim = h('div.scrim', { hidden: true, onclick: () => toggle(false) });
      const toggle = (open) => { side.classList.toggle('open', open); scrim.hidden = !open; };
      side.addEventListener('click', (e) => { if (e.target.closest('a')) toggle(false); });
      page = h('main.page#page');
      const bell = AF.notifBell && u.tenant_id ? AF.notifBell() : null;
      const top = h('div.topbar', h('button.burger', { 'aria-label': 'Menu', onclick: () => toggle(true) }, icon('menu')), h('div.brand', h('div.mark', h('i'), h('i'), h('i')), AF.state.boot.app.name), h('div.grow'), bell);
      root.appendChild(h('div.shell#shell', side, h('div.main', top, page), scrim));
      AF._side = side; AF._bell = bell;
    }
    // menu latéral (reconstruit à chaque navigation pour l'état actif et les compteurs)
    const side = AF._side; clear(side);
    const item = (href, ic, label, opt = {}) => h('a' + (opt.active ? '.on' : ''), { href }, icon(ic), label, opt.count ? h('span.count', String(opt.count)) : null);
    const on = (re) => re.test(path);
    const nav = h('nav.nav', { 'aria-label': 'Navigation principale' });
    if (u.role === 'superadmin') {
      nav.appendChild(item('#/super', 'building', 'Clients & licences', { active: on(/^\/super/) }));
    } else {
      nav.appendChild(item('#/', 'dash', 'Tableau de bord', { active: path === '/' }));
      if (AF.is('manager', 'ops_manager', 'director', 'admin')) nav.appendChild(item('#/approvals', 'check', 'À valider', { active: on(/^\/approvals/), count: b.pending }));
      nav.appendChild(item('#/fae', 'file', AF.is('buyer') && !b.settings.shared_view ? 'Mes FAE' : 'Toutes les FAE', { active: /^\/fae(\/(?!new)\d+)?$/.test(path) }));
      if (AF.is('buyer', 'admin')) nav.appendChild(item('#/fae/new', 'plus', 'Nouvelle FAE', { active: path === '/fae/new' }));
      nav.appendChild(item('#/suppliers', 'building', 'Fournisseurs', { active: on(/^\/suppliers/) }));
      nav.appendChild(item('#/export', 'download', 'Extractions', { active: on(/^\/export/) }));
      if (AF.is('admin')) {
        nav.appendChild(h('div.navgroup', 'Administration'));
        [['users', 'users', 'Utilisateurs'], ['fields', 'sliders', 'Fiche & champs'], ['workflow', 'flow', 'Circuit de validation'], ['notifications', 'bell', 'Alertes'], ['license', 'key', 'Licence']]
          .forEach(([k, ic, l]) => nav.appendChild(item('#/admin/' + k, ic, l, { active: path === '/admin/' + k })));
        nav.appendChild(item('#/admin/more', 'list', 'Autres réglages', { active: /^\/admin\/(lists|refs|budgets|settings|audit|more)/.test(path) }));
      }
    }
    const roleLabel = u.role === 'superadmin' ? 'Éditeur' : (b.roles[u.role] || u.role);
    side.append(
      h('div.brand', h('div.mark', h('i'), h('i'), h('i')), b.app.name),
      b.tenant ? h('div.tenant-tag', h('b', b.tenant.name), b.license.state === 'grace' || b.license.state === 'expired' || b.license.state === 'suspended' ? 'Licence à renouveler' : b.license.plan_label) : null,
      nav,
      h('div.side-foot', h('div.who', u.name), h('div.role', roleLabel), h('div.row.gap-l.mt', { style: { marginTop: '10px' } },
        u.role !== 'superadmin' ? h('a.row.gap-s', { href: '#/profile' }, icon('sliders'), 'Mon profil') : null,
        h('a.row.gap-s', { href: '#/login', onclick: async (e) => { e.preventDefault(); try { await api.post('/auth/logout'); } catch (x) { /* noop */ } AF.state.user = null; AF.state.boot = null; AF._side = null; location.hash = '#/login'; AF.navigate(); } }, icon('logout'), 'Quitter'))));
    if (AF._bell && AF._bell.refresh) AF._bell.refresh();
    const old = document.getElementById('storage-warn'); if (old) old.remove();
    if (b.storage && b.storage.persistent === false) {
      const warn = h('div.notice.bad#storage-warn', { style: { borderRadius: 0, borderWidth: '0 0 1px 0', margin: 0 } }, icon('alert'), h('div', h('b', 'Stockage non permanent : les données saisies seront effacées au prochain redémarrage du serveur. '),
        'L\'hébergeur n\'a pas de disque persistant monté sur ' + b.storage.dir + '. Ajoutez un disque (Render : Settings, Disks, point de montage /data) avant de saisir des données réelles.'));
      page.parentNode.insertBefore(warn, page);
    }
    return page;
  };

  // cloche de notifications
  AF.notifBell = function () {
    const dot = h('span.dot', { hidden: true });
    const pop = h('div.pop', { hidden: true });
    const btn = h('button.bell', { 'aria-label': 'Notifications', onclick: async (e) => {
      e.stopPropagation();
      if (!pop.hidden) { pop.hidden = true; return; }
      try {
        const r = await api.get('/notifications');
        clear(pop);
        if (!r.rows.length) pop.appendChild(h('div.empty-state', 'Aucune notification.'));
        r.rows.forEach((n) => pop.appendChild(h('a.item' + (n.read_at ? '' : '.unread'), { href: n.fae_id ? '#/fae/' + n.fae_id : '#/' }, h('b', n.subject), h('span', AF.F.dt(n.created_at)))));
        pop.hidden = false;
        if (r.unread) { await api.post('/notifications/read'); dot.hidden = true; }
      } catch (x) { fail(x); }
    } }, icon('bell'), dot);
    const box = h('div', { style: { position: 'relative' } }, btn, pop);
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) pop.hidden = true; });
    box.refresh = () => { const n = AF.state.boot && AF.state.boot.unread; dot.hidden = !n; dot.textContent = n > 9 ? '9+' : n; };
    return box;
  };

  // Routes
  const R = AF.route;
  R(/^\/login$/, 'login', { public: true, redirectIfAuth: true });
  R(/^\/forgot$/, 'forgot', { public: true });
  R(/^\/reset\/([\w-]+)$/, 'reset', { public: true });
  R(/^\/$/, 'home');
  R(/^\/fae$/, 'faeList');
  R(/^\/fae\/new$/, 'faeForm', { roles: ['buyer', 'admin'] });
  R(/^\/fae\/(\d+)\/edit$/, 'faeForm', { roles: ['buyer', 'admin'] });
  R(/^\/fae\/(\d+)$/, 'faeDetail');
  R(/^\/approvals$/, 'approvals');
  R(/^\/export$/, 'exportView');
  R(/^\/suppliers$/, 'suppliers');
  R(/^\/profile$/, 'profile');
  R(/^\/admin\/(users|fields|workflow|notifications|license|lists|refs|budgets|settings|audit|more)$/, 'admin', { roles: ['admin'] });
  R(/^\/super$/, 'superConsole', { roles: ['superadmin'] });

  AF.views.home = async (host, ctx) => (AF.is('superadmin') ? (location.hash = '#/super', undefined) : AF.views.dashboard(host, ctx));

  // Démarrage : la session est vérifiée par le routeur (bootstrap ou redirection vers la connexion)
  window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.status !== 401) console.error(e.reason); });
  AF.navigate();
})();
