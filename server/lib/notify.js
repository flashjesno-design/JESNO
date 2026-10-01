'use strict';
/* Alertes : e-mail (SMTP), WhatsApp (Meta Cloud API ou Twilio) et notifications dans l'application. */
const nodemailer = require('nodemailer');
const config = require('../config');
const db = require('../db');
const { jparse, nowSql } = require('./util');
const { getLicense, hasFeature } = require('./license');

const EVENT_LABELS = {
  submitted: 'FAE soumise (aux validateurs)',
  step_approved: 'Étape validée (à l\'acheteur)',
  approved: 'FAE validée définitivement',
  rejected: 'FAE rejetée',
  reminder: 'Rappel de validation en retard',
  escalation: 'Escalade hiérarchique',
  comment: 'Nouveau commentaire'
};

const DEFAULT_TEMPLATES = {
  submitted: {
    subject: 'FAE {number} à valider — {title}',
    body: 'Bonjour {name},\n\n{buyer} vous soumet la fiche {number} « {title} » pour l\'étape « {step} ».\nFournisseur retenu : {supplier} — Montant final : {amount}.\n\nOuvrir la fiche : {link}',
    wa: '{buyer} vous soumet la FAE à valider ({step}). Fournisseur : {supplier}, montant : {amount}'
  },
  step_approved: {
    subject: 'FAE {number} : étape « {step} » validée',
    body: 'Bonjour {name},\n\n{actor} a validé l\'étape « {step} » de la fiche {number} « {title} ».\n{next}\n\nOuvrir la fiche : {link}',
    wa: '{actor} a validé l\'étape « {step} ». {next}'
  },
  approved: {
    subject: 'FAE {number} validée ✔ — {title}',
    body: 'Bonjour {name},\n\nLa fiche {number} « {title} » est validée par tous les intervenants. Vous pouvez poursuivre la commande avec {supplier} ({amount}).\n\nOuvrir la fiche : {link}',
    wa: 'FAE validée par tous les intervenants. Fournisseur : {supplier}, montant : {amount}'
  },
  rejected: {
    subject: 'FAE {number} rejetée — action requise',
    body: 'Bonjour {name},\n\n{actor} a rejeté la fiche {number} « {title} » à l\'étape « {step} ».\nMotif : {comment}\n\nCorrigez la fiche puis soumettez-la à nouveau : {link}',
    wa: 'Rejetée par {actor} ({step}). Motif : {comment}'
  },
  reminder: {
    subject: 'Rappel : FAE {number} en attente de votre validation',
    body: 'Bonjour {name},\n\nLa fiche {number} « {title} » attend votre validation (étape « {step} ») depuis {hours} h.\n\nOuvrir la fiche : {link}',
    wa: 'Rappel : en attente de votre validation depuis {hours} h ({step})'
  },
  escalation: {
    subject: 'Escalade : FAE {number} bloquée depuis {hours} h',
    body: 'Bonjour {name},\n\nLa fiche {number} « {title} » attend une validation depuis {hours} h (validateur(s) : {approvers}, étape « {step} »).\n\nOuvrir la fiche : {link}',
    wa: 'Escalade : validation en attente depuis {hours} h chez {approvers}'
  },
  comment: {
    subject: 'Nouveau commentaire sur la FAE {number}',
    body: 'Bonjour {name},\n\n{actor} a commenté la fiche {number} « {title} » :\n« {comment} »\n\nOuvrir la fiche : {link}',
    wa: '{actor} a commenté : {comment}'
  }
};

function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '')); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function templatesFor(tenantSettings, event) {
  const custom = ((tenantSettings.notifications || {}).templates || {})[event] || {};
  return { ...DEFAULT_TEMPLATES[event], ...Object.fromEntries(Object.entries(custom).filter(([, v]) => v)) };
}

function normalizePhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0') && config.DEFAULT_COUNTRY_CODE) return config.DEFAULT_COUNTRY_CODE + d.slice(1);
  return d;
}

let transporter = null;
function getTransporter() {
  if (!config.SMTP.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP.host, port: config.SMTP.port, secure: config.SMTP.secure,
      auth: config.SMTP.user ? { user: config.SMTP.user, pass: config.SMTP.pass } : undefined
    });
  }
  return transporter;
}

function emailHtml(subject, body, link) {
  const paras = esc(body).split('\n\n').map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#1c2536">
  <div style="background:#14213d;color:#fff;padding:14px 20px;font-weight:bold;font-size:16px">${esc(config.APP_NAME)}</div>
  <div style="border:1px solid #d9dee7;border-top:0;padding:22px 20px;font-size:14px;line-height:1.5">${paras}
  ${link ? `<p style="margin:22px 0 0"><a href="${esc(link)}" style="background:#2f5d8a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-weight:bold;display:inline-block">Ouvrir dans ${esc(config.APP_NAME)}</a></p>` : ''}
  </div><p style="font-size:11px;color:#7a8497;text-align:center">Message automatique — ne pas répondre.</p></div>`;
}

async function sendEmail(n) {
  const t = getTransporter();
  if (!t) return { status: 'simulated', error: 'SMTP non configuré : message consigné mais non envoyé.' };
  await t.sendMail({
    from: config.SMTP.from || config.SMTP.user, to: n.recipient, subject: n.subject,
    text: n.body + (n.link ? `\n\n${n.link}` : ''), html: emailHtml(n.subject, n.body, n.link)
  });
  return { status: 'sent' };
}

async function postJson(url, body, headers) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${txt.slice(0, 300)}`);
    return txt;
  } finally { clearTimeout(to); }
}

const waClean = (s, max) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

async function sendWhatsApp(n) {
  const w = config.WHATSAPP;
  const to = normalizePhone(n.recipient);
  if (!to) return { status: 'failed', error: 'Numéro WhatsApp manquant ou invalide.' };
  const meta = jparse(n.meta, {});
  if (w.provider === 'meta' && w.metaToken && w.metaPhoneId) {
    // Modèle approuvé à 4 variables : {{1}} nom, {{2}} n° FAE, {{3}} message, {{4}} lien
    await postJson(`https://graph.facebook.com/${w.metaVersion}/${w.metaPhoneId}/messages`, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: w.template, language: { code: w.lang }, components: [{ type: 'body', parameters: [
        { type: 'text', text: waClean(meta.name, 60) || 'Bonjour' },
        { type: 'text', text: waClean(meta.number, 40) },
        { type: 'text', text: waClean(n.body, 300) },
        { type: 'text', text: waClean(n.link, 200) }] }] }
    }, { Authorization: `Bearer ${w.metaToken}` });
    return { status: 'sent' };
  }
  if (w.provider === 'twilio' && w.twilioSid && w.twilioToken && w.twilioFrom) {
    const form = new URLSearchParams({ From: w.twilioFrom.startsWith('whatsapp:') ? w.twilioFrom : `whatsapp:${w.twilioFrom}`, To: `whatsapp:+${to}` });
    if (w.twilioContentSid) {
      form.set('ContentSid', w.twilioContentSid);
      form.set('ContentVariables', JSON.stringify({ 1: waClean(meta.name, 60), 2: waClean(meta.number, 40), 3: waClean(n.body, 300), 4: waClean(n.link, 200) }));
    } else form.set('Body', `${waClean(meta.number, 40)} — ${n.body}\n${n.link || ''}`);
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${w.twilioSid}/Messages.json`, {
        method: 'POST', body: form, signal: ctrl.signal,
        headers: { Authorization: 'Basic ' + Buffer.from(`${w.twilioSid}:${w.twilioToken}`).toString('base64') }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    } finally { clearTimeout(tm); }
    return { status: 'sent' };
  }
  return { status: 'simulated', error: 'WhatsApp non configuré : message consigné mais non envoyé.' };
}

let flushing = false;
async function flush() {
  if (flushing) return; flushing = true;
  try {
    const rows = db.prepare("SELECT * FROM notifications WHERE status = 'queued' AND channel IN ('email','whatsapp') ORDER BY id LIMIT 50").all();
    for (const n of rows) {
      let res;
      try { res = n.channel === 'email' ? await sendEmail(n) : await sendWhatsApp(n); }
      catch (e) { res = { status: 'failed', error: String(e.message || e).slice(0, 500) }; }
      db.prepare('UPDATE notifications SET status = ?, error = ?, sent_at = ? WHERE id = ?').run(res.status, res.error || null, nowSql(), n.id);
    }
  } finally { flushing = false; }
}

/** Crée les notifications d'un événement pour une liste d'utilisateurs. */
function notify({ tenantId, userIds, event, fae, vars = {} }) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  const settings = jparse(tenant.settings, {});
  const lic = getLicense(tenantId);
  const evCfg = (((settings.notifications || {}).events || {})[event]) || { email: true, whatsapp: false, inapp: true };
  const tpl = templatesFor(settings, event);
  const link = fae ? `${config.BASE_URL}/#/fae/${fae.id}` : config.BASE_URL;
  const uniq = [...new Set(userIds)].filter(Boolean);
  const ins = db.prepare('INSERT INTO notifications (tenant_id,user_id,fae_id,channel,event,recipient,subject,body,link,status,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  uniq.forEach((uid) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
    if (!u) return;
    const v = { app: config.APP_NAME, name: u.name.split(' ')[0], link, number: fae ? fae.number : '', title: fae ? (fae.title || '') : '', ...vars };
    const subject = fill(tpl.subject, v);
    const body = fill(tpl.body, v);
    const wa = fill(tpl.wa, v);
    if (u.notif_inapp && evCfg.inapp !== false) ins.run(tenantId, u.id, fae ? fae.id : null, 'inapp', event, null, subject, body, link, 'sent', null);
    if (u.notif_email && evCfg.email && u.email) ins.run(tenantId, u.id, fae ? fae.id : null, 'email', event, u.email, subject, body, link, 'queued', null);
    if (u.notif_whatsapp && evCfg.whatsapp && u.phone && hasFeature(lic, 'whatsapp')) {
      ins.run(tenantId, u.id, fae ? fae.id : null, 'whatsapp', event, u.phone, subject, wa, link, 'queued', JSON.stringify({ name: v.name, number: v.number }));
    }
  });
  setImmediate(() => flush().catch((e) => console.error('[notify]', e.message)));
}

/** E-mail direct (réinitialisation de mot de passe, invitation…). */
function queueEmail({ tenantId, userId, to, subject, body, link, event = 'system' }) {
  db.prepare('INSERT INTO notifications (tenant_id,user_id,channel,event,recipient,subject,body,link,status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(tenantId || null, userId || null, 'email', event, to, subject, body, link || null, 'queued');
  setImmediate(() => flush().catch((e) => console.error('[notify]', e.message)));
}

module.exports = { notify, queueEmail, flush, EVENT_LABELS, DEFAULT_TEMPLATES, templatesFor, fill, normalizePhone };
