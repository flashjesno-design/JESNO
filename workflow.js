'use strict';
/* Moteur de workflow de validation : étapes séquentielles, conditions par montant, délégation, rappels, escalade. */
const db = require('../db');
const { nowSql, addHours, todayIso, jparse, httpError, ROLES } = require('./util');
const { notify } = require('./notify');

const COND_FIELDS = {
  final_xof: 'Montant final (CFA)', budget_xof: 'Budget (CFA)', initial_xof: 'Offre initiale retenue (CFA)',
  offers_count: 'Nombre de fournisseurs consultés', purchase_type: "Type d'achat", spend_nature: 'Nature de dépense',
  department: 'Département', strategy: 'Stratégie achat'
};

function condMatches(cond, fae) {
  if (!cond || !cond.field) return true;
  const v = fae[cond.field];
  const target = cond.value;
  const numeric = ['final_xof', 'budget_xof', 'initial_xof', 'offers_count'].includes(cond.field);
  if (numeric) {
    const a = Number(v ?? 0), b = Number(target);
    switch (cond.op) { case 'gte': return a >= b; case 'gt': return a > b; case 'lte': return a <= b; case 'lt': return a < b; case 'eq': return a === b; case 'ne': return a !== b; default: return true; }
  }
  const a = String(v ?? '').trim().toLowerCase(), b = String(target ?? '').trim().toLowerCase();
  return cond.op === 'ne' ? a !== b : a === b;
}

function tenantUsers(tenantId) { return db.prepare('SELECT * FROM users WHERE tenant_id = ? AND active = 1').all(tenantId); }

function isDelegating(u) { return !!(u.delegate_id && u.delegate_until && u.delegate_until >= todayIso()); }

/** Utilisateurs pouvant agir sur une étape (titulaires + délégués actifs), hors acheteur de la fiche. */
function eligibleApprovers(step, fae) {
  const users = tenantUsers(fae.tenant_id);
  const ids = step.approver_type === 'list' ? jparse(step.approver_ids, []) : null;
  const titulars = users.filter((u) => u.id !== fae.buyer_id && (ids ? ids.includes(u.id) : step.approver_type === 'user' ? u.id === step.approver_user_id : u.role === step.approver_role));
  const set = new Map(titulars.map((u) => [u.id, u]));
  titulars.forEach((t) => {
    if (isDelegating(t)) {
      const d = users.find((x) => x.id === t.delegate_id);
      if (d && d.id !== fae.buyer_id) set.set(d.id, d);
    }
  });
  return [...set.values()];
}

function canAct(user, step, fae) {
  if (!user || !step || step.status !== 'pending') return false;
  return eligibleApprovers(step, fae).some((u) => u.id === user.id);
}

function logEvent(fae, user, type, message, meta) {
  db.prepare('INSERT INTO fae_events (fae_id,tenant_id,user_id,user_name,type,message,meta) VALUES (?,?,?,?,?,?,?)')
    .run(fae.id, fae.tenant_id, user ? user.id : null, user ? user.name : 'Système', type, message || null, meta ? JSON.stringify(meta) : null);
}

const nf = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' '));
function faeVars(fae) {
  const buyer = db.prepare('SELECT name FROM users WHERE id = ?').get(fae.buyer_id);
  return { buyer: buyer ? buyer.name : '', supplier: fae.supplier_name || '—', amount: fae.final != null ? `${nf(fae.final)} ${fae.currency || ''}`.trim() : '—' };
}

function activateStep(fae, step) {
  const now = nowSql();
  db.prepare("UPDATE fae_steps SET status='pending', activated_at=?, due_at=? WHERE id=?").run(now, step.sla_hours ? addHours(step.sla_hours) : null, step.id);
  db.prepare('UPDATE fae SET current_step=?, updated_at=? WHERE id=?').run(step.position, now, fae.id);
  const approvers = eligibleApprovers(step, fae);
  notify({ tenantId: fae.tenant_id, userIds: approvers.map((u) => u.id), event: 'submitted', fae, vars: { ...faeVars(fae), step: step.name } });
}

/** Soumission (ou re-soumission) d'une FAE au circuit de validation. */
function submit(fae, user) {
  if (!['draft', 'rejected'].includes(fae.status)) throw httpError(409, 'Cette FAE ne peut plus être soumise.');
  const defs = db.prepare('SELECT * FROM workflow_steps WHERE tenant_id = ? AND active = 1 ORDER BY position, id').all(fae.tenant_id);
  if (!defs.length) throw httpError(422, 'Aucun circuit de validation actif : contactez l\'administrateur.');
  const cycle = (fae.status === 'rejected' ? fae.cycle + 1 : fae.cycle);
  const tx = db.transaction(() => {
    const ins = db.prepare(`INSERT INTO fae_steps (fae_id,tenant_id,cycle,position,name,approver_type,approver_role,approver_user_id,approver_ids,status,sla_hours,reminder_hours,escalate_after_hours,escalate_role)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let pos = 0; const created = [];
    defs.forEach((d) => {
      pos += 1;
      const applies = condMatches(jparse(d.condition, null), fae);
      const info = ins.run(fae.id, fae.tenant_id, cycle, pos, d.name, d.approver_type, d.approver_role, d.approver_user_id, d.approver_ids || null, applies ? 'waiting' : 'skipped', d.sla_hours, d.reminder_hours, d.escalate_after_hours, d.escalate_role);
      created.push({ id: info.lastInsertRowid, position: pos, applies });
    });
    const active = db.prepare("SELECT * FROM fae_steps WHERE fae_id=? AND cycle=? AND status='waiting' ORDER BY position").all(fae.id, cycle);
    if (!active.length) throw httpError(422, 'Aucune étape de validation ne s\'applique à cette FAE (vérifiez les conditions du circuit).');
    for (const s of active) {
      if (!eligibleApprovers(s, fae).length) throw httpError(422, `Aucun validateur disponible pour l'étape « ${s.name} ». Demandez à l'administrateur de désigner un validateur actif pour ce niveau (le demandeur ne peut pas valider sa propre fiche).`);
    }
    db.prepare("UPDATE fae SET status='in_review', cycle=?, submitted_at=?, validated_at=NULL, updated_at=? WHERE id=?").run(cycle, nowSql(), nowSql(), fae.id);
    logEvent(fae, user, 'submitted', cycle > 1 ? `Nouvelle soumission (version ${cycle})` : 'FAE soumise pour validation', { cycle });
    return active[0];
  });
  const first = tx();
  const fresh = db.prepare('SELECT * FROM fae WHERE id = ?').get(fae.id);
  activateStep(fresh, first);
  return fresh;
}

function currentStep(fae) {
  return db.prepare("SELECT * FROM fae_steps WHERE fae_id = ? AND cycle = ? AND status = 'pending' ORDER BY position LIMIT 1").get(fae.id, fae.cycle);
}

function decide(fae, user, decision, comment) {
  if (fae.status !== 'in_review') throw httpError(409, 'Cette FAE n\'est pas en cours de validation.');
  const step = currentStep(fae);
  if (!step) throw httpError(409, 'Aucune étape en attente.');
  if (!canAct(user, step, fae)) throw httpError(403, 'Vous n\'êtes pas le validateur de cette étape.');
  comment = String(comment || '').trim();
  if (decision === 'reject' && comment.length < 3) throw httpError(422, 'Indiquez le motif du rejet.');
  const now = nowSql();
  const status = decision === 'approve' ? 'approved' : 'rejected';
  let outcome;
  db.transaction(() => {
    db.prepare('UPDATE fae_steps SET status=?, acted_by=?, acted_by_name=?, acted_at=?, comment=? WHERE id=?').run(status, user.id, user.name, now, comment || null, step.id);
    if (decision === 'reject') {
      db.prepare("UPDATE fae_steps SET status='cancelled' WHERE fae_id=? AND cycle=? AND status='waiting'").run(fae.id, fae.cycle);
      db.prepare("UPDATE fae SET status='rejected', current_step=0, updated_at=? WHERE id=?").run(now, fae.id);
      logEvent(fae, user, 'rejected', comment, { step: step.name });
      outcome = { kind: 'rejected' };
    } else {
      logEvent(fae, user, 'step_approved', comment || `Étape « ${step.name} » validée`, { step: step.name });
      const next = db.prepare("SELECT * FROM fae_steps WHERE fae_id=? AND cycle=? AND status='waiting' ORDER BY position LIMIT 1").get(fae.id, fae.cycle);
      if (next) outcome = { kind: 'next', next };
      else {
        db.prepare("UPDATE fae SET status='approved', current_step=0, validated_at=?, updated_at=? WHERE id=?").run(now, now, fae.id);
        logEvent(fae, null, 'approved', 'FAE validée par tous les intervenants');
        outcome = { kind: 'approved' };
      }
    }
  })();
  const fresh = db.prepare('SELECT * FROM fae WHERE id = ?').get(fae.id);
  const v = { ...faeVars(fresh), step: step.name, actor: user.name, comment };
  if (outcome.kind === 'rejected') notify({ tenantId: fae.tenant_id, userIds: [fae.buyer_id], event: 'rejected', fae: fresh, vars: v });
  else if (outcome.kind === 'next') {
    notify({ tenantId: fae.tenant_id, userIds: [fae.buyer_id], event: 'step_approved', fae: fresh, vars: { ...v, next: `Prochaine étape : « ${outcome.next.name} ».` } });
    activateStep(fresh, outcome.next);
  } else {
    const actors = db.prepare("SELECT DISTINCT acted_by FROM fae_steps WHERE fae_id=? AND cycle=? AND acted_by IS NOT NULL").all(fae.id, fae.cycle).map((r) => r.acted_by);
    notify({ tenantId: fae.tenant_id, userIds: [fae.buyer_id, ...actors], event: 'approved', fae: fresh, vars: v });
  }
  return db.prepare('SELECT * FROM fae WHERE id = ?').get(fae.id);
}

function recall(fae, user) {
  if (fae.status !== 'in_review') throw httpError(409, 'Seule une FAE en validation peut être rappelée.');
  db.transaction(() => {
    db.prepare("UPDATE fae_steps SET status='cancelled' WHERE fae_id=? AND cycle=? AND status IN ('waiting','pending')").run(fae.id, fae.cycle);
    db.prepare("UPDATE fae SET status='draft', current_step=0, updated_at=? WHERE id=?").run(nowSql(), fae.id);
    logEvent(fae, user, 'recalled', 'FAE rappelée par l\'acheteur pour modification');
  })();
  return db.prepare('SELECT * FROM fae WHERE id = ?').get(fae.id);
}

/** FAE en attente de validation pour un utilisateur donné. */
function pendingFor(user) {
  const rows = db.prepare(`SELECT s.*, f.number, f.title, f.supplier_name, f.final, f.currency, f.final_xof, f.buyer_id, f.tenant_id, f.cycle AS fae_cycle, f.department,
      (SELECT name FROM users WHERE id = f.buyer_id) AS buyer_name
    FROM fae_steps s JOIN fae f ON f.id = s.fae_id
    WHERE s.tenant_id = ? AND s.status = 'pending' AND f.status = 'in_review' AND s.cycle = f.cycle ORDER BY s.due_at`).all(user.tenant_id);
  return rows.filter((r) => canAct(user, r, { tenant_id: r.tenant_id, buyer_id: r.buyer_id }));
}

/** Rappels et escalades (exécuté périodiquement). */
function tick() {
  const now = nowSql();
  const rows = db.prepare(`SELECT s.*, f.number, f.title, f.supplier_name, f.final, f.currency, f.buyer_id, f.id AS fid
    FROM fae_steps s JOIN fae f ON f.id = s.fae_id WHERE s.status='pending' AND f.status='in_review' AND s.cycle=f.cycle`).all();
  let sent = 0;
  rows.forEach((s) => {
    const fae = db.prepare('SELECT * FROM fae WHERE id = ?').get(s.fid);
    const hours = Math.max(1, Math.round((Date.now() - new Date(s.activated_at.replace(' ', 'T') + 'Z').getTime()) / 3600e3));
    const approvers = eligibleApprovers(s, fae);
    if (s.due_at && s.due_at <= now) {
      const gap = s.reminder_hours || 0;
      const last = s.last_reminder_at;
      const due = !last || (gap > 0 && addHours(gap, last) <= now);
      if (due) {
        notify({ tenantId: s.tenant_id, userIds: approvers.map((u) => u.id), event: 'reminder', fae, vars: { ...faeVars(fae), step: s.name, hours } });
        db.prepare('UPDATE fae_steps SET last_reminder_at=? WHERE id=?').run(now, s.id);
        logEvent(fae, null, 'reminder', `Rappel envoyé aux validateurs (${hours} h d'attente)`, { step: s.name });
        sent++;
      }
    }
    if (s.escalate_after_hours && !s.escalated_at && addHours(s.escalate_after_hours, s.activated_at) <= now) {
      const escRole = s.escalate_role;
      const targets = tenantUsers(s.tenant_id).filter((u) => u.role === escRole && u.id !== fae.buyer_id).map((u) => u.id);
      notify({ tenantId: s.tenant_id, userIds: [...targets, fae.buyer_id], event: 'escalation', fae, vars: { ...faeVars(fae), step: s.name, hours, approvers: approvers.map((u) => u.name).join(', ') } });
      db.prepare('UPDATE fae_steps SET escalated_at=? WHERE id=?').run(now, s.id);
      logEvent(fae, null, 'escalation', `Escalade envoyée (${hours} h d'attente)`, { step: s.name });
      sent++;
    }
  });
  return sent;
}

module.exports = { COND_FIELDS, submit, decide, recall, canAct, currentStep, pendingFor, eligibleApprovers, tick, logEvent, condMatches, ROLES };
