'use strict';
/* Test de fumée : démarre le serveur sur une base temporaire et déroule le parcours complet. Usage : npm test */
const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'achatflow-'));
Object.assign(process.env, { DATA_DIR: tmp, NODE_ENV: 'test', SUPERADMIN_EMAIL: 'editeur@test.local', SUPERADMIN_PASSWORD: 'Editeur2026!', JWT_SECRET: 'test-secret' });
const { createApp, ensureSuperAdmin } = require('../server/index');
const seed = require('../scripts/seed-demo');

let base; const jars = {};
async function call(who, method, url, body) {
  const isForm = body instanceof FormData;
  const headers = { Cookie: jars[who] || '' }; if (!isForm) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + '/api' + url, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : null };
}
const ok = (name) => console.log('  ok  ' + name);

(async () => {
  ensureSuperAdmin(); seed.run();
  const server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await call('x', 'GET', '/bootstrap'); assert.strictEqual(r.status, 401); ok('accès refusé sans session');
    r = await call('buyer', 'POST', '/auth/login', { email: 'acheteur@demo.local', password: 'mauvais' }); assert.strictEqual(r.status, 401); ok('mauvais mot de passe refusé');
    for (const [k, e] of [['buyer', 'acheteur@demo.local'], ['manager', 'manager@demo.local'], ['director', 'directeur@demo.local'], ['admin', seed.ADMIN_LOGIN], ['super', 'editeur@test.local']]) {
      r = await call(k, 'POST', '/auth/login', { email: e, password: k === 'super' ? 'Editeur2026!' : (k === 'admin' ? seed.ADMIN_PASSWORD : 'Demo2026!') }); assert.strictEqual(r.status, 200, e);
    }
    ok('connexion des 5 profils');
    r = await call('buyer', 'GET', '/bootstrap'); assert.ok(r.data.fields.length >= 40); const boot = r.data;
    const key = (role) => boot.fields.find((f) => f.scope === 'fae' && f.role === role).key;
    const okey = (role) => boot.fields.find((f) => f.scope === 'offer' && f.role === role).key;
    const data = { [key('pr_number')]: '4500999999', [key('requester')]: 'Test', [key('department')]: 'HSE', [key('spend_nature')]: 'OPEX', [key('purchase_type')]: 'Achat Simple', [key('title')]: 'Fourniture de test', [key('pscs')]: '030201',
      [key('currency')]: 'EURO', [key('budget')]: 1000, [key('amount_final')]: 900, [key('strategy')]: 'RFQ', [key('criteria')]: 'Meilleure offre conforme et délai le plus court.' };
    const offers = [1000, 1100, 1200].map((a, i) => ({ retained: i === 0, data: { [okey('o_supplier')]: 'Fournisseur ' + i, [okey('o_conformity')]: 'CONFORME', [okey('o_amount')]: a } }));
    r = await call('buyer', 'POST', '/fae', { data, offers }); assert.strictEqual(r.status, 201); const id = r.data.id; ok('création de la FAE');
    r = await call('buyer', 'GET', '/fae/' + id); assert.strictEqual(Math.round(r.data.final_xof), Math.round(900 * 655.957)); ok('conversion EURO vers CFA exacte');
    r = await call('manager', 'POST', `/fae/${id}/approve`); assert.strictEqual(r.status, 409); ok('validation impossible avant soumission');
    r = await call('buyer', 'POST', `/fae/${id}/submit`, { data, offers }); assert.strictEqual(r.status, 200); assert.strictEqual(r.data.status, 'in_review'); ok('soumission');
    r = await call('buyer', 'POST', `/fae/${id}/approve`); assert.strictEqual(r.status, 403); ok('l\'acheteur ne peut pas valider sa propre fiche');
    r = await call('director', 'POST', `/fae/${id}/approve`); assert.strictEqual(r.status, 403); ok('le directeur ne peut pas court-circuiter le manager');
    r = await call('manager', 'GET', '/fae/approvals'); assert.ok(r.data.items.some((i) => i.fae_id === id)); ok('la fiche apparaît chez le manager');
    r = await call('manager', 'POST', `/fae/${id}/approve`, { comment: 'OK' }); assert.strictEqual(r.data.status, 'in_review');
    r = await call('director', 'POST', `/fae/${id}/approve`); assert.strictEqual(r.data.status, 'approved'); ok('circuit manager puis directeur');
    r = await call('buyer', 'PUT', '/fae/' + id, { data, offers }); assert.strictEqual(r.status, 409); ok('fiche validée non modifiable');
    r = await call('buyer', 'GET', '/dashboard'); assert.ok(r.data.kpis.count > 0); ok('dashboard');
    const csv = await fetch(base + '/api/export/csv', { headers: { Cookie: jars.buyer } }); assert.ok((await csv.text()).includes('FAE-')); ok('export CSV');

    // ── Fournisseurs : import CSV en deux temps
    const csvData = '\uFEFFNom fournisseur;Code fournisseur;Pays;Mails contact\nSOCIETE TEST A;FT-1;Côte d\'Ivoire;"a@test.ci; b@test.ci"\n"TEST, B SARL";FT-2;France;pas-un-mail\n;FT-3;Ghana;\nSOCIETE TEST A;FT-1;Côte d\'Ivoire;\n';
    const form = (mode) => { const f = new FormData(); f.append('file', new Blob([csvData], { type: 'text/csv' }), 'fournisseurs.csv'); f.append('mode', mode); return f; };
    r = await call('buyer', 'POST', '/suppliers/import', form('preview'));
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.summary.new, 2); assert.strictEqual(r.data.summary.error, 2); ok('import CSV : aperçu (2 nouveaux, 2 lignes rejetées)');
    r = await call('buyer', 'POST', '/suppliers/import', form('commit')); assert.strictEqual(r.data.summary.new, 2);
    r = await call('buyer', 'GET', '/suppliers?q=SOCIETE TEST A'); assert.strictEqual(r.data.rows[0].email, 'a@test.ci; b@test.ci'); ok('import CSV : e-mails multiples enregistrés');
    r = await call('buyer', 'POST', '/suppliers/import', form('preview')); assert.strictEqual(r.data.summary.new, 0); assert.strictEqual(r.data.summary.same, 2); ok('réimport : pas de doublon');
    const tpl = await fetch(base + '/api/suppliers/template.xlsx', { headers: { Cookie: jars.buyer } }); assert.strictEqual(tpl.status, 200); ok('modèle Excel téléchargeable');

    // ── Circuit : validateurs nommés, compte créé automatiquement
    r = await call('admin', 'GET', '/admin/workflow');
    const wf = r.data.steps.map((st) => ({ ...st, validators: [] }));
    wf[0].approver_type = 'list'; wf[0].validators = [{ name: 'Valideur Externe', email: 'valideur.externe@test.local', phone: '0701020304' }];
    r = await call('admin', 'PUT', '/admin/workflow', { steps: wf });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.created.length, 1); ok('validateur nommé : compte créé automatiquement');
    const vpwd = r.data.created[0].temp_password;
    r = await call('buyer', 'POST', '/fae', { data, offers }); const id2 = r.data.id;
    r = await call('buyer', 'POST', `/fae/${id2}/submit`, { data, offers }); assert.strictEqual(r.status, 200);
    r = await call('manager', 'POST', `/fae/${id2}/approve`); assert.strictEqual(r.status, 403); ok('seul le validateur désigné peut viser ce niveau');
    const dbm = require('../server/db');
    const notes = dbm.prepare("SELECT channel FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'valideur.externe@test.local' AND n.event = 'submitted'").all().map((x) => x.channel);
    assert.ok(notes.includes('email') && notes.includes('whatsapp'), JSON.stringify(notes)); ok('alerte e-mail et WhatsApp préparées pour le validateur');
    r = await call('val', 'POST', '/auth/login', { email: 'valideur.externe@test.local', password: vpwd }); assert.strictEqual(r.status, 200);
    r = await call('val', 'POST', `/fae/${id2}/approve`); assert.strictEqual(r.status, 200); ok('le validateur désigné vise la fiche');

    // ── Vue partagée : un acheteur voit les fiches d'un autre acheteur
    r = await call('b2', 'POST', '/auth/login', { email: 'acheteur2@demo.local', password: 'Demo2026!' });
    r = await call('b2', 'GET', '/fae/' + id); assert.strictEqual(r.status, 200); ok('vue partagée : fiche d\'un collègue visible');
    r = await call('admin', 'PUT', '/admin/settings', { settings: { shared_view: false } });
    r = await call('b2', 'GET', '/fae/' + id); assert.ok([403, 404].includes(r.status)); ok('vue individuelle : fiche d\'un collègue masquée');
    await call('admin', 'PUT', '/admin/settings', { settings: { shared_view: true } });

    // ── Console éditeur : utilisateurs d'une entreprise
    r = await call('super', 'GET', '/super/tenants'); const demoT = r.data.tenants.find((t) => t.slug === 'demo');
    r = await call('super', 'POST', `/super/tenants/${demoT.id}/users`, { name: 'Ajouté par éditeur', email: 'ajout@demo.local', role: 'buyer' }); assert.strictEqual(r.status, 201);
    r = await call('super', 'GET', `/super/tenants/${demoT.id}/users`); assert.ok(r.data.users.some((u) => u.email === 'ajout@demo.local')); ok('console éditeur : utilisateur ajouté à une entreprise');
    r = await call('admin', 'POST', '/admin/users', { name: 'Nouveau', email: 'nouveau@demo.local', role: 'buyer' }); assert.strictEqual(r.status, 201); ok('création d\'utilisateur');
    r = await call('buyer', 'GET', '/admin/users'); assert.strictEqual(r.status, 403); ok('l\'administration est réservée à l\'admin');
    r = await call('super', 'POST', '/super/tenants', { name: 'Client B', admin_name: 'Admin B', admin_email: 'b@clientb.test', plan: 'starter' }); assert.strictEqual(r.status, 201); ok('création d\'un second client');
    r = await call('x2', 'POST', '/auth/login', { email: 'b@clientb.test', password: r.data.temp_password }); assert.strictEqual(r.status, 200);
    r = await call('x2', 'GET', '/fae'); assert.strictEqual(r.data.total, 0); r = await call('x2', 'GET', '/fae/' + id); assert.strictEqual(r.status, 404); ok('isolation entre clients');
    r = await call('x2', 'POST', '/admin/fields', { label: 'Test', type: 'text' }); assert.strictEqual(r.status, 402); ok('licence Starter : champs personnalisés bloqués');
    console.log('\nTous les tests passent.');
  } catch (e) { console.error('\nÉCHEC :', e.message); process.exitCode = 1; }
  finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 200); }
})();
