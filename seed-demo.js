'use strict';
/* Données de démonstration : un client fictif, 8 utilisateurs, ~70 FAE réparties sur l'année. */
const bcrypt = require('bcryptjs');
const db = require('../server/db');
const { provisionTenant } = require('../server/lib/defaults');
const { makeKey, PLANS } = require('../server/lib/license');
const svc = require('../server/lib/fae-service');
const wf = require('../server/lib/workflow');
const { loadModel } = require('../server/lib/model');

const DEMO_PASSWORD = 'Demo2026!';
// Accès administrateur du client de démonstration (identifiant libre, pas forcément une adresse e-mail).
const ADMIN_LOGIN = 'admin', ADMIN_PASSWORD = 'admin';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const R = rng(20260920);
const pick = (a) => a[Math.floor(R() * a.length)];
const between = (a, b) => a + R() * (b - a);
const iso = (d) => d.toISOString().slice(0, 10);
const sql = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const addD = (d, n) => new Date(d.getTime() + n * 86400e3);

const THEMES = {
  '01': ['Approvisionnement en gypse', 'Fourniture de laitier de haut fourneau', 'Achat de cendres volantes', 'Livraison de pouzzolane'],
  '02': ['Fourniture de charbon', 'Achat de pet-coke', 'Combustibles alternatifs (coques de noix)'],
  '03': ['Sacs papier 50 kg', 'Palettes bois', 'Housses de palettisation'],
  '04': ['Pièces de rechange broyeur', 'Roulements SKF', 'Réducteurs et accouplements', 'Briques réfractaires four', 'Chaînes et convoyeurs'],
  '05': ['Prestation de maintenance mécanique', 'Contrat de nettoyage industriel', 'Location de grue mobile', 'Travaux de génie civil'],
  '06': ['Transport routier de ciment', 'Affrètement de bulk-carrier', 'Manutention portuaire'],
  '07': ['Licences logicielles', 'Prestation de conseil', 'Fournitures de bureau', 'Équipements informatiques']
};
const CRITERIA = ['Fournisseur techniquement conforme, meilleure offre après négociation.', 'Retenu pour le meilleur rapport qualité/prix et le délai de livraison le plus court.', 'Seul fournisseur homologué sur cet équipement, prix négocié à la baisse.', 'Offre la plus compétitive, conditions de paiement à 60 jours obtenues.'];
const REQUESTERS = ['A. Kouassi', 'M. Traoré', 'S. Koné', 'F. Yao', 'N. Diallo', 'K. Bamba', 'J. Ouattara', 'E. N\'Guessan'];

function run() {
  if (db.prepare("SELECT 1 FROM tenants WHERE slug = 'demo'").get()) { console.log('Client de démonstration déjà présent.'); return; }
  const plan = 'enterprise';
  const tid = db.prepare("INSERT INTO tenants (name,slug,brand_color) VALUES ('Cimenterie Démo SA','demo','#2f5d8a')").run().lastInsertRowid;
  provisionTenant(tid, { withReference: true });
  const exp = iso(addD(new Date(), 365));
  db.prepare("INSERT INTO licenses (tenant_id,plan,license_key,max_users,max_fae_month,features,starts_at,expires_at) VALUES (?,?,?,?,?,?,date('now'),?)")
    .run(tid, plan, makeKey({ slug: 'demo', plan, max_users: PLANS[plan].max_users, max_fae_month: 0, features: PLANS[plan].features, expires_at: exp }), PLANS[plan].max_users, 0, JSON.stringify(PLANS[plan].features), exp);

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const mk = (email, name, role, phone, pwdHash) => db.prepare('INSERT INTO users (tenant_id,email,name,phone,role,password_hash,notif_whatsapp) VALUES (?,?,?,?,?,?,?)').run(tid, email, name, phone || null, role, pwdHash || hash, phone ? 1 : 0).lastInsertRowid;
  const admin = mk(ADMIN_LOGIN, 'Administrateur', 'admin', null, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  const buyers = [mk('acheteur@demo.local', 'Jean Acheteur', 'buyer', '0700000001'), mk('acheteur2@demo.local', 'Mariam Acheteuse', 'buyer'), mk('acheteur3@demo.local', 'Serge Acheteur', 'buyer')];
  mk('manager@demo.local', 'Patrice Manager Achats', 'manager', '0700000002');
  mk('ops@demo.local', 'Claire Responsable Ops', 'ops_manager');
  mk('directeur@demo.local', 'Olivier Directeur Ops', 'director', '0700000003');
  mk('controle@demo.local', 'Rita Contrôle de gestion', 'viewer');
  void admin;

  // budgets 2026
  const depts = db.prepare("SELECT value FROM ref_items WHERE tenant_id = ? AND list_key = 'department'").all(tid).map((r) => r.value);
  depts.forEach((d) => db.prepare('INSERT INTO budgets (tenant_id,year,department,amount_xof) VALUES (?,?,?,?)').run(tid, 2026, d, Math.round(between(60, 900)) * 1e6));

  const model = loadModel(tid);
  const classes = db.prepare("SELECT code, short_name FROM pscs WHERE tenant_id = ? AND level = 'Classe'").all(tid);
  const suppliers = db.prepare('SELECT name, currency FROM suppliers WHERE tenant_id = ? LIMIT 400').all(tid);
  const users = (role) => db.prepare('SELECT * FROM users WHERE tenant_id = ? AND role = ? LIMIT 1').get(tid, role);
  const manager = users('manager'), director = users('director');
  const list = (k) => (model.lists[k] || []).map((i) => i.value);
  const strat = list('strategy'), ptype = list('purchase_type'), sav = list('saving_type');

  const start = new Date('2026-01-08T08:00:00Z'), today = new Date('2026-09-18T08:00:00Z');
  const total = 72;
  for (let i = 0; i < total; i++) {
    const created = addD(start, (i / total) * ((today - start) / 86400e3) + R() * 2);
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(pick(buyers));
    const cls = pick(classes);
    const themes = THEMES[cls.code.slice(0, 2)] || THEMES['04'];
    const cur = pick(['CFA', 'CFA', 'CFA', 'EURO', 'EURO', 'USD']);
    const fx = cur === 'CFA' ? 1 : cur === 'EURO' ? 655.957 : 585;
    const finalCfa = Math.round(Math.exp(between(Math.log(2.5e6), Math.log(650e6))));
    const final = Math.round(finalCfa / fx);
    const hist = R() < 0.65 ? Math.round(final * between(1.02, 1.28)) : '';
    const budget = Math.round(final * between(0.98, 1.3));
    const n = R() < 0.1 ? 1 : R() < 0.15 ? 2 : 3 + Math.floor(R() * 3);
    const chosen = Math.floor(R() * n);
    const offers = [];
    const winnerInitial = Math.round(final * between(1.0, 1.15));
    for (let k = 0; k < n; k++) {
      const sup = pick(suppliers);
      const amt = k === chosen ? winnerInitial : Math.round(final * between(1.02, 1.5));
      offers.push({ retained: k === chosen, data: { supplier: sup.name + (k ? ` ${k}` : ''), conformity: k === chosen || R() < 0.8 ? 'CONFORME' : pick(['NON CONFORME', 'OFFRE NON RECUE']), amount_initial: amt, delay: pick(['2 semaines', '4 semaines', '6 semaines', 'Stock local', '10 jours']), incoterm: cur === 'CFA' ? '' : pick(['DAP', 'CIF', 'FCA']), origin: cur === 'CFA' ? "Côte d'Ivoire" : pick(['France', 'Allemagne', 'Chine', 'Turquie']), wht: cur === 'CFA' ? 'N/A' : 'OUI' } });
    }
    const launch = addD(created, -between(6, 20));
    const data = {
      pr_number: String(4500000000 + Math.floor(R() * 900000)), requester: pick(REQUESTERS), department: pick(depts), spend_nature: R() < 0.3 ? 'CAPEX' : 'OPEX', purchase_type: pick(ptype),
      pr_date: iso(addD(launch, -3)), title: pick(themes), pscs: cls.code, supplier_category: pick(list('supplier_category')), currency: cur, fx_rate: cur === 'CFA' ? '' : fx, budget, historical_price: hist,
      saving_type: hist ? sav[0] : sav[1], launch_channel: pick(['FAIRMARKIT', 'MAIL']), strategy: n === 1 ? 'GRE A GRE' : pick(strat.slice(0, 2)), contract: pick(['OUI', 'NON']),
      launch_date: iso(launch), end_date: iso(addD(launch, between(5, 16))), derogation: n < 3 ? 'OUI' : 'NON', committee: 'NON', criteria: pick(CRITERIA), amount_final: final
    };
    if (data.launch_channel === 'FAIRMARKIT') data.fairmarkit_ref = 'FM-' + (100000 + Math.floor(R() * 899999));
    const id = svc.save({ tenantId: tid, user: buyer, id: null, payload: { data, offers } });

    const r = R();
    const fae = () => svc.getRow(id, tid);
    let submitted = addD(created, between(0.2, 3)), validated = null;
    if (r < 0.08) { db.prepare("UPDATE fae SET created_at=?, updated_at=? WHERE id=?").run(sql(created), sql(created), id); continue; } // brouillon
    wf.submit(fae(), buyer);
    if (r < 0.22) { // en validation, étape 1 ou 3
      if (r < 0.15) wf.decide(fae(), manager, 'approve', 'OK pour moi.');
      const late = addD(today, -between(0.2, 5));
      db.prepare('UPDATE fae SET created_at=?, submitted_at=?, updated_at=? WHERE id=?').run(sql(created), sql(late), sql(late), id);
      db.prepare("UPDATE fae_steps SET activated_at=?, due_at=? WHERE fae_id=? AND status='pending'").run(sql(late), sql(addD(late, 2)), id);
      db.prepare('UPDATE fae_events SET created_at=? WHERE fae_id=?').run(sql(late), id);
      continue;
    }
    if (r < 0.27) { wf.decide(fae(), manager, 'reject', 'Merci de joindre la fiche de dérogation et de préciser les critères.'); db.prepare('UPDATE fae SET created_at=?, submitted_at=?, updated_at=? WHERE id=?').run(sql(created), sql(submitted), sql(addD(submitted, 1)), id); continue; }
    wf.decide(fae(), manager, 'approve', R() < 0.3 ? 'Validé.' : '');
    wf.decide(fae(), director, 'approve', R() < 0.3 ? 'Accord.' : '');
    const h1 = between(3, 30), h2 = between(4, 60);
    validated = new Date(submitted.getTime() + (h1 + h2) * 3600e3);
    db.prepare("UPDATE fae SET created_at=?, submitted_at=?, validated_at=?, updated_at=? WHERE id=?").run(sql(created), sql(submitted), sql(validated), sql(validated), id);
    const steps = db.prepare('SELECT id, position FROM fae_steps WHERE fae_id = ? AND status = ? ORDER BY position').all(id, 'approved');
    steps.forEach((s, ix) => { const act = ix === 0 ? new Date(submitted.getTime() + h1 * 3600e3) : validated; const from = ix === 0 ? submitted : new Date(submitted.getTime() + h1 * 3600e3); db.prepare('UPDATE fae_steps SET activated_at=?, acted_at=?, due_at=? WHERE id=?').run(sql(from), sql(act), sql(addD(from, 2)), s.id); });
    db.prepare('UPDATE fae_events SET created_at=? WHERE fae_id=?').run(sql(validated), id);
  }
  db.prepare("UPDATE notifications SET status = 'simulated' WHERE status = 'queued' AND tenant_id = ?").run(tid);
  console.log(`Démo créée : client « Cimenterie Démo SA » — connexion administrateur ${ADMIN_LOGIN} / ${ADMIN_PASSWORD} (voir README pour les autres rôles).`);
}

if (require.main === module) run();
module.exports = { run, DEMO_PASSWORD, ADMIN_LOGIN, ADMIN_PASSWORD };
