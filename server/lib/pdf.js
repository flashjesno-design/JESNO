'use strict';
/* Génération PDF de la fiche FAE (une ou plusieurs fiches, une par page). */
const PDFDocument = require('pdfkit');
const config = require('../config');
const { STATUS_LABELS, ROLES } = require('./util');
const Calc = require('../../shared/calc');

const EXTRA = new Set([0x20AC, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2026, 0x0153, 0x0152]);
function T(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\u202f\u00a0]/g, ' ').replace(/₂/g, '2').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->')
    .replace(/✔/g, 'v').replace(/[\u0300-\u036f]/g, '').split('').filter((c) => c.charCodeAt(0) < 256 || EXTRA.has(c.charCodeAt(0))).join('');
}
const nf = (n, d = 0) => Number(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',');
const fdate = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const fdt = (s) => (s ? `${fdate(s)} ${String(s).slice(11, 16)}` : '');

function fmtValue(field, v, model, currency) {
  if (v === '' || v === null || v === undefined) return '';
  const fmt = field.type === 'calc' ? (field.options || {}).format : field.type;
  if (fmt === 'money') return `${nf(v, 0)} ${field.key.endsWith('_xof') || field.scope === 'offer' && field.key === 'amount_xof' ? 'CFA' : (currency || '')}`.trim();
  if (fmt === 'percent') return `${nf(Number(v) * 100, 1)} %`;
  if (fmt === 'number') return nf(v, field.decimals ?? 2);
  if (field.type === 'date') return fdate(v);
  if (field.type === 'checkbox') return v ? 'Oui' : 'Non';
  return String(v);
}

function renderFaePdf(out, faes, model, tenant) {
  const doc = new PDFDocument({ size: 'A4', margin: 34, bufferPages: true, info: { Title: `FAE ${faes.map((f) => f.number).join(', ').slice(0, 80)}`, Author: config.APP_NAME } });
  doc.pipe(out);
  const W = doc.page.width - 68;
  const INK = '#14213d', GREY = '#5b6577', LINE = '#c9d0dc';

  faes.forEach((fae, idx) => {
    if (idx > 0) doc.addPage();
    const data = fae.data || {};
    const currency = fae.currency || 'CFA';
    let y = 34;

    // en-tête
    doc.rect(34, y, W, 44).fill(INK);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text(T(tenant.name).toUpperCase(), 44, y + 9, { width: W * 0.6 });
    doc.font('Helvetica').fontSize(9).text("FICHE D'ANALYSE D'EXPRESSION DE BESOIN", 44, y + 25);
    doc.font('Helvetica-Bold').fontSize(13).text(T(fae.number), 34, y + 9, { width: W - 10, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).text(`Statut : ${T(STATUS_LABELS[fae.status] || fae.status)}`, 34, y + 26, { width: W - 10, align: 'right' });
    y += 54;
    doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(`Acheteur : ${T(fae.buyer_name)}   |   Date de FAE : ${fdate(fae.created_at)}   |   Version : ${fae.cycle}   |   Devise : ${T(currency)}`, 34, y);
    y += 16;
    doc.y = y;

    const ensure = (h) => { if (doc.y + h > doc.page.height - 50) { doc.addPage(); doc.y = 34; } };

    const sections = model.sections.filter((s) => s.scope === 'fae');
    sections.forEach((sec) => {
      const fields = model.faeFields.filter((f) => f.section_key === sec.key && Calc.isVisible(f, data));
      if (!fields.length) return;
      ensure(50);
      const sy = doc.y;
      doc.rect(34, sy, W, 16).fill(sec.color || INK);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(T(sec.label), 40, sy + 4, { width: W - 12 });
      doc.y = sy + 20;
      // grille 4 colonnes
      const col = W / 4;
      let x = 0; let rowTop = doc.y; let rowH = 0;
      const flush = () => { doc.y = rowTop + rowH + 4; rowTop = doc.y; x = 0; rowH = 0; };
      fields.forEach((f) => {
        const w = Math.min(4, Math.max(1, f.width || 2));
        if (x + w > 4) flush();
        ensure(34);
        if (x === 0) rowTop = doc.y;
        const fx = 34 + x * col;
        const val = T(fmtValue(f, data[f.key], model, currency)) || '—';
        const isBig = f.type === 'textarea';
        doc.font('Helvetica').fontSize(7).fillColor(GREY).text(T(f.label), fx + 2, rowTop, { width: col * w - 8 });
        const ly = rowTop + 9;
        doc.font(f.role === 'amount_final' || f.role === 'effort' ? 'Helvetica-Bold' : 'Helvetica').fontSize(isBig ? 8.5 : 9).fillColor('#111827');
        const h = doc.heightOfString(val, { width: col * w - 8 });
        doc.text(val, fx + 2, ly, { width: col * w - 8 });
        rowH = Math.max(rowH, 9 + h + 3);
        doc.moveTo(fx + 2, ly + h + 1.5).lineTo(fx + col * w - 6, ly + h + 1.5).strokeColor('#e3e7ee').lineWidth(0.5).stroke();
        x += w;
      });
      flush();
      doc.y += 2;
      // offres après la section « lancement » (avant la décision)
      if (sec.key === 'lancement') drawOffers();
    });
    if (!sections.some((s) => s.key === 'lancement')) drawOffers();

    function drawOffers() {
      const offSec = model.sections.find((s) => s.scope === 'offer');
      const offers = fae.offers || [];
      if (!offers.length) return;
      ensure(120);
      const sy = doc.y;
      doc.rect(34, sy, W, 16).fill(offSec ? offSec.color : '#b4531a');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(T(offSec ? offSec.label : 'Fournisseurs consultés'), 40, sy + 4);
      doc.y = sy + 20;
      const labelW = 112; const cw = (W - labelW) / Math.max(offers.length, 1);
      let ty = doc.y;
      // entête colonnes
      doc.rect(34, ty, labelW, 14).fill('#eef1f6');
      offers.forEach((o, i) => {
        doc.rect(34 + labelW + i * cw, ty, cw, 14).fill(o.retained ? '#1e7f5c' : '#eef1f6');
        doc.fillColor(o.retained ? '#fff' : INK).font('Helvetica-Bold').fontSize(7.5).text(o.retained ? `Fournisseur ${i + 1} - RETENU` : `Fournisseur ${i + 1}`, 34 + labelW + i * cw + 3, ty + 4, { width: cw - 6 });
      });
      ty += 14;
      model.offerFields.forEach((f) => {
        const vals = offers.map((o) => T(fmtValue(f, (o.data || {})[f.key], model, currency)) || '—');
        const h = Math.max(13, ...vals.map((v) => doc.font('Helvetica').fontSize(8).heightOfString(v, { width: cw - 6 }) + 5));
        if (ty + h > doc.page.height - 50) { doc.addPage(); ty = 34; }
        doc.rect(34, ty, labelW, h).fill('#f7f8fb');
        doc.fillColor(GREY).font('Helvetica').fontSize(7.5).text(T(f.label), 37, ty + 3, { width: labelW - 6 });
        vals.forEach((v, i) => {
          doc.fillColor('#111827').font(f.role === 'o_supplier' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(v, 34 + labelW + i * cw + 3, ty + 3, { width: cw - 6 });
        });
        doc.moveTo(34, ty + h).lineTo(34 + W, ty + h).strokeColor(LINE).lineWidth(0.4).stroke();
        ty += h;
      });
      doc.y = ty + 8;
    }

    // visas
    const cycleSteps = (fae.steps || []).filter((s) => s.cycle === fae.cycle);
    ensure(90);
    const vy = doc.y + 2;
    doc.rect(34, vy, W, 16).fill(INK);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('VISAS DE VALIDATION', 40, vy + 4);
    let by = vy + 22;
    const shown = cycleSteps.filter((s) => s.status !== 'skipped');
    const bw = shown.length ? Math.min(W / shown.length, 200) : W;
    shown.forEach((s, i) => {
      const bx = 34 + i * bw;
      doc.rect(bx, by, bw - 6, 64).strokeColor(LINE).lineWidth(0.8).stroke();
      const col = s.status === 'approved' ? '#1e7f5c' : s.status === 'rejected' ? '#b3261e' : s.status === 'pending' ? '#a86a00' : GREY;
      doc.fillColor(GREY).font('Helvetica').fontSize(7).text(T(s.name), bx + 5, by + 5, { width: bw - 16 });
      doc.fillColor(col).font('Helvetica-Bold').fontSize(9).text(s.status === 'approved' ? 'VALIDÉ' : s.status === 'rejected' ? 'REJETÉ' : s.status === 'pending' ? 'EN ATTENTE' : 'À VENIR', bx + 5, by + 22, { width: bw - 16 });
      doc.fillColor('#111827').font('Helvetica').fontSize(7.5).text(T(s.acted_by_name ? `${s.acted_by_name}\n${fdt(s.acted_at)}` : (s.due_at ? `Échéance : ${fdt(s.due_at)}` : '')), bx + 5, by + 36, { width: bw - 16 });
    });
    if (!shown.length) doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8.5).text('FAE non encore soumise au circuit de validation.', 40, by + 4);
    doc.y = by + 72;
    doc.fillColor(GREY).font('Helvetica').fontSize(7).text(`Document généré par ${T(config.APP_NAME)} le ${fdate(new Date().toISOString())}.`, 34, doc.y + 4, { width: W });
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fillColor('#8a93a5').font('Helvetica').fontSize(7).text(`Page ${i + 1} / ${range.count}`, 34, doc.page.height - 26, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
}

module.exports = { renderFaePdf, T, fdate };
