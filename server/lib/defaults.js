'use strict';
/* Modèle par défaut — reprend fidèlement la fiche « FAE V5 » (Excel) : champs, listes, calculs, visas. */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const YN = ['OUI', 'NON', 'EN COURS'];

const LISTS = [
  { key: 'purchase_type', label: "Type d'achat", items: ['Achat Simple', 'Achats à Complexité Moyenne', 'Achats à Complexité Élevée'] },
  { key: 'spend_nature', label: 'Nature de la dépense', items: ['CAPEX', 'OPEX'] },
  { key: 'department', label: 'Départements prescripteurs', items: ['DORH', 'DAF-IT', 'INBOUND LOGISTICS', 'USINE - MAGASIN', 'USINE - NEULANDT', 'USINE - MAINTENANCE', 'USINE - EXPEDITION', 'USINE - LABO', 'DORH - COMM', 'DORH - MG', 'BOUAKE - CARRIERE', 'DCM', 'Dir. Juridique', 'OUTBOUND LOGISTICS', 'USINE - PROJET', 'HSE', 'USINE - ELECTRICITE', 'USINE - PROCEDE', 'USINE - PRODUCTION'] },
  { key: 'saving_type', label: 'Types de saving', items: ['Saving réalisé/ cout historique ( Année N-1)', 'Coût évité réalisé sur nouveau produit ou service', 'Autre Coût évité réalisé'] },
  { key: 'currency', label: 'Devises (taux vers CFA)', items: [
    { value: 'CFA', meta: { rate: 1 } }, { value: 'EURO', meta: { rate: 655.957 } },
    { value: 'USD', meta: { rate: null, note: 'Renseigner le taux à date' } }, { value: 'CHF', meta: { rate: 714.19 } }] },
  { key: 'launch_channel', label: 'Moyens de lancement', items: ['FAIRMARKIT', 'MAIL'] },
  { key: 'strategy', label: 'Stratégies achat', items: ['RFQ', 'RFP', 'GRE A GRE', 'FO :BORDEREAU DE PRIX', 'TACITE RECONDUCTION'] },
  { key: 'yes_no_pending', label: 'Oui / Non / En cours', items: YN },
  { key: 'conformity', label: 'Conformité technique', items: ['CONFORME', 'NON CONFORME', 'OFFRE NON RECUE'] },
  { key: 'wht', label: 'WHT applicable', items: ['OUI', 'N/A'] },
  { key: 'incoterm', label: 'Incoterms', items: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] },
  { key: 'supplier_category', label: 'Catégories fournisseur', items: [
    { value: 'Fournisseur de biens standards', meta: { description: 'Fournisseur de biens (produits, équipements, consommables) hors matière première minière.' } },
    { value: 'Fournisseur de matières premières extraites par voie minière', meta: { description: 'Fournisseur de matières premières extraites du sol par voie minière.' } },
    { value: 'Catégorie 1', meta: { description: 'Personnes engagées sous contrat temporaire, opérations supervisées en continu par la filiale, sans travail dangereux ni environnement dangereux.' } },
    { value: 'Catégorie 2', meta: { description: 'Entreprises/personnes engagées pour des opérations existantes, sans travail dangereux ni environnement dangereux.' } },
    { value: 'Catégorie 3', meta: { description: 'Entreprises/personnes engagées pour des opérations impliquant un travail dangereux et/ou un environnement dangereux, sur site. Risque ESG/HSE élevé.' } },
    { value: 'Catégorie 4', meta: { description: 'Transporteurs routiers effectuant un travail dangereux et/ou dans un environnement dangereux, en général en dehors des sites.' } }] }
];

const SECTIONS = [
  { scope: 'fae', key: 'identification', label: 'Identification de la demande', color: '#2f5d8a' },
  { scope: 'fae', key: 'classification', label: "Classification & catégorie fournisseur", color: '#1e7f5c' },
  { scope: 'fae', key: 'budget', label: 'Budget & devise', color: '#a86a00' },
  { scope: 'fae', key: 'lancement', label: 'Lancement de la consultation', color: '#4a5a70' },
  { scope: 'fae', key: 'decision', label: 'Décision & bilan financier', color: '#14213d' },
  { scope: 'offer', key: 'offers', label: 'Fournisseurs consultés', color: '#b4531a' }
];

const F = (scope, key, label, type, section_key, o = {}) => ({ scope, key, label, type, section_key, ...o });
const NEQ_CFA = JSON.stringify({ field: 'currency', op: 'ne', value: 'CFA' });

const FIELDS = [
  // ── Identification
  F('fae', 'pr_number', 'Numéro PR', 'text', 'identification', { required: 1, role: 'pr_number', width: 2, help: 'Numéro de la demande d\'achat (PR / DA) dans SAP.' }),
  F('fae', 'requester', 'Nom prescripteur', 'text', 'identification', { required: 1, role: 'requester', width: 2 }),
  F('fae', 'department', 'Département prescripteur', 'select', 'identification', { required: 1, list_key: 'department', role: 'department', width: 2 }),
  F('fae', 'spend_nature', 'Nature de la dépense', 'select', 'identification', { required: 1, list_key: 'spend_nature', role: 'spend_nature', width: 2 }),
  F('fae', 'purchase_type', "Type d'achat", 'select', 'identification', { required: 1, list_key: 'purchase_type', role: 'purchase_type', width: 2 }),
  F('fae', 'pr_date', 'Date de création / validation PR', 'date', 'identification', { role: 'pr_date', width: 2 }),
  F('fae', 'title', 'Objet de la demande', 'textarea', 'identification', { required: 1, role: 'title', width: 4, placeholder: 'Décrivez le besoin en une ou deux phrases.' }),
  // ── Classification
  F('fae', 'pscs', "PSCS — classe d'achat", 'pscs', 'classification', { required: 1, role: 'pscs', width: 4, help: 'Cherchez par mot-clé ou par code : le domaine d\'achat est déduit automatiquement.' }),
  F('fae', 'supplier_category', 'Catégorie fournisseur', 'select', 'classification', { list_key: 'supplier_category', role: 'supplier_category', width: 4 }),
  // ── Budget
  F('fae', 'currency', 'Devise', 'select', 'budget', { required: 1, list_key: 'currency', default_value: 'CFA', role: 'currency', width: 1 }),
  F('fae', 'fx_rate', 'Taux de conversion vers CFA', 'number', 'budget', { role: 'fx_rate', decimals: 4, width: 1, visible_if: NEQ_CFA, help: 'Taux à la date de la FAE (obligatoire si la devise n\'est pas le CFA).' }),
  F('fae', 'budget', 'Montant budget', 'money', 'budget', { required: 1, role: 'budget', width: 1 }),
  F('fae', 'historical_price', 'Prix historique', 'money', 'budget', { role: 'historical', width: 1, help: 'Dernier prix payé (N-1). Laisser vide pour un nouveau produit ou service.' }),
  F('fae', 'saving_type', 'Type de saving', 'select', 'budget', { list_key: 'saving_type', role: 'saving_type', width: 4 }),
  F('fae', 'budget_xof', 'Budget converti (CFA)', 'calc', 'budget', { formula: 'IF(OR(ISBLANK({budget}),{currency}="CFA"),"",{budget}*{FX})', options: JSON.stringify({ format: 'money' }), width: 2, visible_if: NEQ_CFA }),
  F('fae', 'historical_xof', 'Prix historique converti (CFA)', 'calc', 'budget', { formula: 'IF(OR(ISBLANK({historical_price}),{currency}="CFA"),"",{historical_price}*{FX})', options: JSON.stringify({ format: 'money' }), width: 2, visible_if: NEQ_CFA }),
  // ── Lancement
  F('fae', 'launch_channel', 'Moyen de lancement', 'select', 'lancement', { list_key: 'launch_channel', role: 'launch_channel', width: 2 }),
  F('fae', 'fairmarkit_ref', 'Référence FAIRMARKIT', 'text', 'lancement', { role: 'fairmarkit_ref', width: 2, visible_if: JSON.stringify({ field: 'launch_channel', op: 'eq', value: 'FAIRMARKIT' }) }),
  F('fae', 'strategy', 'Stratégie achat', 'select', 'lancement', { required: 1, list_key: 'strategy', role: 'strategy', width: 2 }),
  F('fae', 'contract', 'Contrat', 'select', 'lancement', { list_key: 'yes_no_pending', role: 'contract', width: 2 }),
  F('fae', 'launch_date', 'Date de lancement', 'date', 'lancement', { role: 'launch_date', width: 2 }),
  F('fae', 'end_date', 'Date de fin (consultation)', 'date', 'lancement', { role: 'end_date', width: 2 }),
  F('fae', 'derogation', 'Fiche de dérogation', 'select', 'lancement', { list_key: 'yes_no_pending', role: 'derogation', width: 2 }),
  F('fae', 'committee', 'Comité achat', 'select', 'lancement', { list_key: 'yes_no_pending', role: 'committee', width: 2 }),
  // ── Décision
  F('fae', 'criteria', 'Critères de choix du fournisseur', 'textarea', 'decision', { required: 1, role: 'criteria', width: 4, placeholder: 'Ex. : fournisseur conforme au besoin, meilleur rapport qualité/prix.' }),
  F('fae', 'amount_initial', 'Montant initial (offre du fournisseur retenu)', 'calc', 'decision', { formula: 'RETAINED("amount_initial")', options: JSON.stringify({ format: 'money' }), role: 'amount_initial', width: 2 }),
  F('fae', 'amount_final', 'Montant final négocié', 'money', 'decision', { required: 1, role: 'amount_final', width: 2 }),
  F('fae', 'final_xof', 'Montant final converti (CFA)', 'calc', 'decision', { formula: 'IF(OR(ISBLANK({amount_final}),{currency}="CFA"),"",{amount_final}*{FX})', options: JSON.stringify({ format: 'money' }), width: 2, visible_if: NEQ_CFA }),
  F('fae', 'saving_budget', 'Savings budget', 'calc', 'decision', { formula: 'IF(OR(ISBLANK({budget}),ISBLANK({amount_final})),"",{budget}-{amount_final})', options: JSON.stringify({ format: 'money' }), width: 2, help: 'Budget − montant final.' }),
  F('fae', 'saving_budget_pct', 'Savings budget (%)', 'calc', 'decision', { formula: 'IF(OR(ISBLANK({budget}),ISBLANK({amount_final}),{budget}=0),"",({budget}-{amount_final})/{budget})', options: JSON.stringify({ format: 'percent' }), width: 2 }),
  F('fae', 'effort', 'Effort acheteur', 'calc', 'decision', { formula: 'IF(ISBLANK({amount_final}),"",IF(ISBLANK({historical_price}),IF(ISBLANK({amount_initial}),"",{amount_initial}-{amount_final}),{historical_price}-{amount_final}))', options: JSON.stringify({ format: 'money' }), width: 2, help: 'Prix historique (ou offre initiale) − montant final.' }),
  F('fae', 'effort_pct', 'Effort acheteur (%)', 'calc', 'decision', { formula: 'IF(ISBLANK({amount_final}),"",IFERROR(IF(ISBLANK({historical_price}),({amount_initial}-{amount_final})/{amount_initial},({historical_price}-{amount_final})/{historical_price}),""))', options: JSON.stringify({ format: 'percent' }), width: 2 }),
  // ── Offres (une colonne par fournisseur consulté)
  F('offer', 'supplier', 'Fournisseur', 'supplier', 'offers', { required: 1, role: 'o_supplier' }),
  F('offer', 'conformity', 'Conformité technique', 'select', 'offers', { required: 1, list_key: 'conformity', role: 'o_conformity' }),
  F('offer', 'amount_initial', 'Offre initiale', 'money', 'offers', { required: 1, role: 'o_amount' }),
  F('offer', 'delay', 'Délai de livraison / disponibilité', 'text', 'offers', { role: 'o_delay' }),
  F('offer', 'amount_xof', 'Montant CFA', 'calc', 'offers', { formula: 'IF(ISBLANK({amount_initial}),"",{amount_initial}*{$FX})', options: JSON.stringify({ format: 'money' }), role: 'o_amount_xof' }),
  F('offer', 'incoterm', 'Incoterm', 'select', 'offers', { list_key: 'incoterm', role: 'o_incoterm' }),
  F('offer', 'origin', "Pays d'origine", 'text', 'offers', { role: 'o_origin' }),
  F('offer', 'wht', 'WHT applicable', 'select', 'offers', { list_key: 'wht', role: 'o_wht' })
];

const DEFAULT_SETTINGS = {
  number_prefix: 'FAE',
  max_offers: 6,
  buyers_see_all: false,
  controls: {
    min_offers: 3,
    min_offers_mode: 'warn',          // off | warn | block
    block_nonconform: true,
    over_budget_mode: 'warn',
    require_justification_not_lowest: true
  },
  notifications: {
    events: {
      submitted: { email: true, whatsapp: true, inapp: true },
      step_approved: { email: true, whatsapp: false, inapp: true },
      approved: { email: true, whatsapp: true, inapp: true },
      rejected: { email: true, whatsapp: true, inapp: true },
      reminder: { email: true, whatsapp: true, inapp: true },
      escalation: { email: true, whatsapp: true, inapp: true },
      comment: { email: false, whatsapp: false, inapp: true }
    },
    templates: {}
  }
};

const STEPS = [
  { position: 1, name: 'Validation Manager / Directeur achats', approver_role: 'manager', sla_hours: 48, reminder_hours: 24, active: 1 },
  { position: 2, name: 'Validation Responsable opérationnel', approver_role: 'ops_manager', sla_hours: 48, reminder_hours: 24, active: 0 },
  { position: 3, name: 'Validation Directeur opérationnel', approver_role: 'director', sla_hours: 72, reminder_hours: 24, escalate_after_hours: 96, escalate_role: 'manager', active: 1 }
];

function provisionTenant(tenantId, { withReference = false } = {}) {
  const tx = db.transaction(() => {
    LISTS.forEach((l) => {
      db.prepare('INSERT OR IGNORE INTO ref_lists (tenant_id,key,label,system) VALUES (?,?,?,1)').run(tenantId, l.key, l.label);
      l.items.forEach((it, i) => {
        const item = typeof it === 'string' ? { value: it } : it;
        db.prepare('INSERT INTO ref_items (tenant_id,list_key,value,label,meta,sort) VALUES (?,?,?,?,?,?)')
          .run(tenantId, l.key, item.value, item.label || item.value, JSON.stringify(item.meta || {}), i);
      });
    });
    SECTIONS.forEach((s, i) => db.prepare('INSERT OR IGNORE INTO sections (tenant_id,scope,key,label,color,sort) VALUES (?,?,?,?,?,?)').run(tenantId, s.scope, s.key, s.label, s.color, i));
    const sortByScope = {};
    FIELDS.forEach((f) => {
      sortByScope[f.scope] = (sortByScope[f.scope] || 0) + 10;
      db.prepare(`INSERT OR IGNORE INTO fields
        (tenant_id,scope,key,label,type,section_key,sort,required,list_key,options,formula,default_value,help,width,visible_if,role,decimals,locked)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
        .run(tenantId, f.scope, f.key, f.label, f.type, f.section_key, sortByScope[f.scope], f.required || 0, f.list_key || null, f.options || null, f.formula || null, f.default_value || null, f.help || null, f.width || 2, f.visible_if || null, f.role || null, f.decimals || null);
    });
    STEPS.forEach((s) => db.prepare(`INSERT INTO workflow_steps (tenant_id,position,name,approver_type,approver_role,sla_hours,reminder_hours,escalate_after_hours,escalate_role,active)
      VALUES (?,?,?,'role',?,?,?,?,?,?)`).run(tenantId, s.position, s.name, s.approver_role, s.sla_hours, s.reminder_hours, s.escalate_after_hours || 0, s.escalate_role || null, s.active));
    const t = db.prepare('SELECT settings FROM tenants WHERE id=?').get(tenantId);
    const cur = JSON.parse(t.settings || '{}');
    if (!cur.controls) db.prepare('UPDATE tenants SET settings=? WHERE id=?').run(JSON.stringify(DEFAULT_SETTINGS), tenantId);
    if (withReference) loadReference(tenantId, withReference === true ? { pscs: true, suppliers: true } : withReference);
  });
  tx();
}

function loadReference(tenantId, opts = { pscs: true, suppliers: true }) {
  const dir = path.join(__dirname, '..', '..', 'seed');
  const pf = path.join(dir, 'pscs.json');
  const sf = path.join(dir, 'suppliers.json');
  if (opts.pscs && fs.existsSync(pf) && !db.prepare('SELECT 1 FROM pscs WHERE tenant_id=? LIMIT 1').get(tenantId)) {
    const ins = db.prepare('INSERT INTO pscs (tenant_id,code,level,short_name,long_name,description,name_en) VALUES (?,?,?,?,?,?,?)');
    JSON.parse(fs.readFileSync(pf, 'utf8')).forEach((r) => ins.run(tenantId, r.code, r.level, r.short, r.long, r.desc, r.en));
  }
  if (opts.suppliers && fs.existsSync(sf) && !db.prepare('SELECT 1 FROM suppliers WHERE tenant_id=? LIMIT 1').get(tenantId)) {
    const ins = db.prepare('INSERT INTO suppliers (tenant_id,ref,name,country,city,currency) VALUES (?,?,?,?,?,?)');
    JSON.parse(fs.readFileSync(sf, 'utf8')).forEach((r) => ins.run(tenantId, r.ref, r.name, r.country, r.city, r.currency));
  }
}

module.exports = { LISTS, SECTIONS, FIELDS, STEPS, DEFAULT_SETTINGS, provisionTenant, loadReference };
