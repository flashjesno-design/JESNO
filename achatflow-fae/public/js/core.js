/* AchatFlow — noyau : DOM, API, formats, modales, routeur. */
(function () {
  'use strict';
  const AF = window.AF = { views: {}, state: { boot: null, user: null }, ui: {} };

  // ── DOM helper : h('div.cls#id', {props}, ...children)
  function h(tag, props, ...kids) {
    const m = String(tag).match(/^([a-z][a-z0-9-]*)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (x, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') v.split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly' || k === 'hidden') el[k] = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  // Element.append accepte désormais tableaux imbriqués, null et false (ignorés).
  const nativeAppend = Element.prototype.append;
  Element.prototype.append = function (...a) { return nativeAppend.apply(this, a.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false)); };
  const $ = (s, r) => (r || document).querySelector(s);
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // ── Icônes
  const P = {
    dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    check: 'M20 6 9 17l-5-5', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16', upload: 'M12 15V3m0 0L8 7m4-4 4 4M4 21h16',
    plus: 'M12 5v14M5 12h14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6', copy: 'M9 9h11v11H9zM5 15V4h11',
    chevron: 'M9 6l6 6-6 6', x: 'M18 6 6 18M6 6l12 12', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
    key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    flow: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9v3a3 3 0 0 0 3 3h6', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    building: 'M3 21h18M5 21V5l7-2 7 2v16M9 9h2M13 9h2M9 13h2M13 13h2M9 17h6', menu: 'M3 6h18M3 12h18M3 18h18', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6', chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    chat: 'M21 11.5a8.4 8.4 0 0 1-12.4 7.3L3 20.5l1.7-5.4A8.5 8.5 0 1 1 21 11.5z', clip: 'M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8',
    comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    db: 'M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8zM4 5.5v13C4 19.9 7.6 21 12 21s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
    wallet: 'M3 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12l2 3M16 14h.01', history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z', star: 'M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z'
  };
  function icon(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.info); s.appendChild(p);
    return s;
  }

  // ── Formats
  const nbsp = (s) => String(s).replace(/[\u202f\u00a0]/g, ' ');
  const F = {
    int: (n) => (n === null || n === undefined || n === '' || isNaN(n) ? '—' : nbsp(Math.round(Number(n)).toLocaleString('fr-FR'))),
    dec: (n, d = 2) => (n === null || n === undefined || n === '' || isNaN(n) ? '—' : nbsp(Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d }))),
    money: (n, cur) => (n === null || n === undefined || n === '' || isNaN(n) ? '—' : `${nbsp(Math.round(Number(n)).toLocaleString('fr-FR'))}${cur ? ' ' + cur : ''}`),
    compact: (n) => {
      if (n === null || n === undefined || isNaN(n)) return '—';
      const a = Math.abs(n), s = n < 0 ? '−' : '';
      if (a >= 1e9) return s + nbsp((a / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })) + ' Md';
      if (a >= 1e6) return s + nbsp((a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })) + ' M';
      if (a >= 1e3) return s + nbsp(Math.round(a / 1e3).toLocaleString('fr-FR')) + ' k';
      return s + Math.round(a);
    },
    pct: (x, d = 1) => (x === null || x === undefined || isNaN(x) ? '—' : nbsp((x * 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d })) + ' %'),
    date: (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''),
    dt: (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? 'Z' : '')); return isNaN(d) ? s : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ''); },
    hours: (hh) => (hh === null || hh === undefined || isNaN(hh) ? '—' : hh < 48 ? `${nbsp(Math.round(hh))} h` : `${nbsp((hh / 24).toLocaleString('fr-FR', { maximumFractionDigits: 1 }))} j`),
    days: (d) => (d === null || d === undefined || isNaN(d) ? '—' : `${nbsp(Number(d).toLocaleString('fr-FR', { maximumFractionDigits: 1 }))} j`),
    month: (ym) => { const [y, m] = ym.split('-'); return ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(m) - 1] + ' ' + y.slice(2); },
    until: (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T') + 'Z') - Date.now(); const hh = Math.round(d / 3600e3); return hh >= 0 ? `dans ${F.hours(hh)}` : `en retard de ${F.hours(-hh)}`; }
  };
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // ── API
  async function api(method, url, body, opts) {
    const init = { method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined && body !== null) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    try { r = await fetch('/api' + url, init); } catch (e) { throw Object.assign(new Error('Connexion au serveur impossible. Vérifiez votre réseau.'), { network: true }); }
    let data = null; const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) data = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 401 && data && data.code === 'UNAUTHENTICATED' && !(opts && opts.quiet401)) { AF.state.user = null; AF.state.boot = null; if (!/^#\/(login|forgot|reset)/.test(location.hash)) location.hash = '#/login'; }
      throw Object.assign(new Error((data && data.error) || `Erreur ${r.status}`), { status: r.status, data });
    }
    return data;
  }
  ['get', 'post', 'put', 'delete'].forEach((m) => { api[m] = (u, b, o) => api(m.toUpperCase(), u, b, o); });
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`).join('&');

  // ── Toasts / modales
  let toasts;
  function toast(msg, kind) {
    if (!toasts) { toasts = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toasts); }
    const t = h('div.toast' + (kind ? '.' + kind : ''), kind === 'ok' ? icon('check') : kind === 'err' ? icon('alert') : null, h('span', msg));
    toasts.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3800);
  }
  const fail = (e) => { if (e && e.status === 401) return; toast(e && e.message ? e.message : String(e), 'err'); };

  function modal({ title, body, actions, size, onClose }) {
    const ov = h('div.overlay', { role: 'dialog', 'aria-modal': 'true' });
    const close = () => { document.removeEventListener('keydown', esc); ov.remove(); if (onClose) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const foot = actions && actions.length ? h('div.modal-f', actions.map((a) => {
      const b = h('button.btn' + (a.cls ? '.' + a.cls.split(' ').join('.') : ''), { type: 'button', onclick: async () => {
        if (!a.onClick) return close();
        b.disabled = true;
        try { const r = await a.onClick(close); if (r !== false) close(); } catch (e) { fail(e); } finally { b.disabled = false; }
      } }, a.icon ? icon(a.icon) : null, a.label);
      return b;
    })) : null;
    const m = h('div.modal' + (size ? '.' + size : ''), h('div.modal-h', h('h2', title), h('button.btn.ghost.icon', { type: 'button', 'aria-label': 'Fermer', onclick: close }, icon('x'))), h('div.modal-b', body), foot);
    ov.appendChild(m); document.body.appendChild(ov); document.addEventListener('keydown', esc);
    const first = m.querySelector('input:not([type=hidden]),textarea,select'); if (first) setTimeout(() => first.focus(), 30);
    return { close, el: m };
  }
  const confirmBox = (title, text, label = 'Confirmer', cls = 'primary') => new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    modal({ title, body: h('div', typeof text === 'string' ? h('p', text) : text), actions: [{ label: 'Annuler', onClick: () => { fin(false); } }, { label, cls, onClick: () => { fin(true); } }], onClose: () => fin(false) });
  });
  const askText = (title, label, { required = true, placeholder = '', confirm = 'Valider', cls = 'primary', hint } = {}) => new Promise((res) => {
    const ta = h('textarea.inp', { placeholder, rows: 3 }); let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    modal({ title, body: h('div.field', h('label', label), ta, hint ? h('div.help', hint) : null), actions: [{ label: 'Annuler', onClick: () => { fin(null); } }, { label: confirm, cls, onClick: () => { if (required && ta.value.trim().length < 3) { toast('Ce champ est obligatoire.', 'err'); return false; } fin(ta.value.trim()); } }], onClose: () => fin(null) });
  });

  // ── Liste de suggestions (PSCS, fournisseurs…)
  function combo({ value = '', placeholder, fetch: fetchRows, renderOpt, onPick, onText, disabled, cls = '' }) {
    const inp = h('input.inp' + (cls ? '.' + cls : ''), { type: 'text', value, placeholder, autocomplete: 'off', disabled, role: 'combobox', 'aria-expanded': 'false' });
    const list = h('div.list', { hidden: true, role: 'listbox' });
    const box = h('div.combo', inp, list);
    let timer, rows = [], hi = -1, seq = 0;
    const hide = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); };
    const paint = () => {
      clear(list);
      if (!rows.length) list.appendChild(h('div.empty', 'Aucun résultat.'));
      rows.forEach((r, i) => { const o = h('div.opt' + (i === hi ? '.hi' : ''), { role: 'option', onmousedown: (e) => { e.preventDefault(); pick(r); } }, renderOpt(r)); list.appendChild(o); });
      list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    };
    const pick = (r) => { hide(); onPick(r, inp); };
    const search = async () => { const my = ++seq; try { const r = await fetchRows(inp.value.trim()); if (my !== seq || document.activeElement !== inp) return; rows = r; hi = -1; paint(); } catch (e) { /* ignoré */ } };
    inp.addEventListener('input', () => { if (onText) onText(inp.value); clearTimeout(timer); timer = setTimeout(search, 180); });
    inp.addEventListener('focus', () => { if (!disabled) search(); });
    inp.addEventListener('blur', () => setTimeout(hide, 120));
    inp.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { hi = Math.min(rows.length - 1, hi + 1); paint(); e.preventDefault(); } else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); paint(); e.preventDefault(); } else if (e.key === 'Enter' && hi >= 0) { pick(rows[hi]); e.preventDefault(); } else if (e.key === 'Escape') hide();
    });
    box.input = inp;
    return box;
  }

  const boolSwitch = (checked, onchange, label) => h('label.switch', { title: label || '' }, h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked), 'aria-label': label || 'Activer' }), h('i'));
  const statusPill = (s, label) => h('span.pill.' + s, label || (AF.state.boot && AF.state.boot.status_labels[s]) || s);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const download = (url) => { const a = h('a', { href: url, download: '' }); document.body.appendChild(a); a.click(); a.remove(); };

  Object.assign(AF, { h, $, clear, icon, F, iso, api, qs, toast, fail, modal, confirmBox, askText, combo, boolSwitch, statusPill, debounce, download });

  // ── Session & données de démarrage
  AF.role = () => (AF.state.user && AF.state.user.role) || null;
  AF.is = (...r) => r.includes(AF.role());
  AF.has = (f) => !!(AF.state.boot && AF.state.boot.license && AF.state.boot.license.features.includes(f));
  AF.model = () => {
    const b = AF.state.boot; if (!b || !b.fields) return null;
    if (!AF._model || AF._modelFor !== b) { AF._model = window.FaeCalc.makeModel({ fields: b.fields.map((f) => ({ ...f })), lists: b.lists, sections: b.sections, settings: b.settings }); AF._modelFor = b; }
    return AF._model;
  };
  AF.loadBoot = async () => {
    const b = await api.get('/bootstrap');
    AF.state.boot = b; AF.state.user = b.user;
    document.documentElement.style.setProperty('--brand', (b.tenant && b.tenant.brand_color) || '#2f5d8a');
    document.documentElement.style.setProperty('--brand-ink', `color-mix(in srgb, ${(b.tenant && b.tenant.brand_color) || '#2f5d8a'} 72%, #000)`);
    document.documentElement.style.setProperty('--brand-wash', `color-mix(in srgb, ${(b.tenant && b.tenant.brand_color) || '#2f5d8a'} 12%, #fff)`);
    return b;
  };

  // ── Circuit de visas (motif signature)
  // steps : [{name, state: done|now|wait|bad|skip, who, when}]
  AF.rail = (steps, { mini, dark, stampIdx } = {}) => h('div.rail' + (mini ? '.mini' : '') + (dark ? '.dark' : ''), steps.map((s, i) =>
    h('div.node.' + s.state + (stampIdx === i ? '.stamp' : ''), h('div.badge', s.state === 'done' ? icon('check') : s.state === 'bad' ? icon('x') : String(i + 1)), h('div.t', s.name), s.sub ? h('div.w', s.sub) : null)));

  // ── Routeur
  const routes = [];
  AF.route = (re, view, opts) => routes.push({ re, view, ...(opts || {}) });
  let cleanup = null, navSeq = 0;
  async function navigate() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const path = hash.split('?')[0];
    const query = Object.fromEntries(new URLSearchParams(hash.split('?')[1] || ''));
    const my = ++navSeq;
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* noop */ } cleanup = null; }
    let r = routes.find((x) => x.re.test(path));
    if (!r) { location.hash = '#/'; return; }
    const params = path.match(r.re).slice(1);
    try {
      if (!AF.state.user && !r.public) {
        try { await AF.loadBoot(); } catch (e) { location.hash = '#/login'; return; }
        if (my !== navSeq) return;
      }
      if (AF.state.user && r.public && r.redirectIfAuth) { location.hash = '#/'; return; }
      if (AF.state.user && AF.state.user.must_change && !r.public && path !== '/profile') { location.hash = '#/profile?force=1'; return; }
      if (r.roles && !AF.is(...r.roles)) { AF.toast('Accès non autorisé.', 'err'); location.hash = '#/'; return; }
      const root = document.getElementById('app');
      let host = root;
      if (!r.public) { host = AF.shell(path); }
      else { clear(root); root.className = ''; }
      clear(host).appendChild(h('div.spinner'));
      const out = await AF.views[r.view](host, { params, query, path });
      if (my !== navSeq) { if (typeof out === 'function') out(); return; }
      cleanup = typeof out === 'function' ? out : null;
      window.scrollTo(0, 0);
    } catch (e) { if (my === navSeq) { fail(e); const host = document.getElementById('page') || document.getElementById('app'); if (host) { clear(host).appendChild(h('div.empty-state', h('h3', 'Une erreur est survenue'), h('p', e.message), h('a.btn', { href: '#/' }, 'Retour à l\'accueil'))); } } }
  }
  AF.navigate = navigate;
  AF.go = (hash) => { if (location.hash === hash) navigate(); else location.hash = hash; };
  window.addEventListener('hashchange', navigate);
})();
