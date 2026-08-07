/**
 * German invoice HTML template (A4, print CSS, self-contained).
 *
 * Kleinunternehmer §19 rules are baked in: NO VAT line, NO "19 % / 7 % / 0 %
 * MwSt.", NO "Nettobetrag + Umsatzsteuer" — only a single Rechnungsbetrag plus
 * the mandatory §19 note. Fonts are system fonts (no external dependency), so
 * the PDF text stays selectable/searchable (not an image).
 */
import { formatMoneyLatin, formatDateDe } from '../../lib/format';
import { DE_LABELS } from '../../config/constants';
import type { DocumentType } from '../../config/constants';

export interface TemplateItem {
  position: number;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  discountCents: number;
  lineTotalCents: number;
  rightsText: string | null;
}

export interface TemplateData {
  invoiceNumber: string;
  documentType: DocumentType;
  invoiceDate: string;
  dueDate: string;
  serviceDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  currency: string;
  seller: Record<string, unknown>;
  customer: Record<string, unknown>;
  customerCode: string;
  projectNumber: string | null;
  projectName: string | null;
  buyerReference: string | null;
  orderReference: string | null;
  items: TemplateItem[];
  totalCents: number;
  taxExemptionText: string;
  paymentTermsText: string | null;
  thanksText: string | null;
  showBank: boolean;
  /** When true, overlays an ENTWURF watermark (draft preview). */
  draft: boolean;
  /** Output language: 'de' (German template) or 'fa' (Persian template). */
  language?: 'de' | 'fa';
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function heading(type: DocumentType): string {
  if (type === 'STORNORECHNUNG') return DE_LABELS.stornorechnung;
  if (type === 'GUTSCHRIFT') return DE_LABELS.gutschrift;
  return DE_LABELS.rechnung;
}

export function renderInvoiceHtml(d: TemplateData): string {
  const s = d.seller;
  const c = d.customer;
  const cur = d.currency;
  const sellerLine1 = [s.full_name, s.business_name].filter(Boolean).join(' · ');
  const custName = (c.company_name as string) || (c.name as string) || '';

  const serviceInfo = d.servicePeriodStart && d.servicePeriodEnd
    ? `${DE_LABELS.leistungszeitraum}: ${formatDateDe(d.servicePeriodStart)} – ${formatDateDe(d.servicePeriodEnd)}`
    : d.serviceDate
      ? `${DE_LABELS.leistungsdatum}: ${formatDateDe(d.serviceDate)}`
      : `${DE_LABELS.leistungsdatum}: ${formatDateDe(d.invoiceDate)}`;

  const rows = d.items.map((it) => {
    const rights = it.rightsText ? `<div class="rights">${esc(it.rightsText)}</div>` : '';
    const discount = it.discountCents ? `<div class="disc">abzügl. ${formatMoneyLatin(it.discountCents, cur)}</div>` : '';
    return `<tr>
      <td class="pos">${it.position}</td>
      <td class="desc">${esc(it.description)}${rights}</td>
      <td class="num">${esc(it.quantity)}</td>
      <td class="unit">${esc(it.unit)}</td>
      <td class="num">${formatMoneyLatin(it.unitPriceCents, cur)}</td>
      <td class="num">${formatMoneyLatin(it.lineTotalCents, cur)}${discount}</td>
    </tr>`;
  }).join('');

  const bankBlock = d.showBank ? `
    <div class="bank">
      <div><strong>${DE_LABELS.iban}:</strong> ${esc(s.iban)}</div>
      ${s.bic ? `<div><strong>${DE_LABELS.bic}:</strong> ${esc(s.bic)}</div>` : ''}
      <div><strong>${DE_LABELS.kontoinhaber}:</strong> ${esc(s.account_holder)}</div>
      ${s.bank_name ? `<div>${esc(s.bank_name)}</div>` : ''}
      <div><strong>${DE_LABELS.verwendungszweck}:</strong> ${esc(d.invoiceNumber)}</div>
    </div>` : '';

  const watermark = d.draft ? `<div class="watermark">${DE_LABELS.entwurf}</div>` : '';
  const stornoNote = d.documentType === 'STORNORECHNUNG'
    ? `<p class="storno-note">Stornorechnung – die ursprüngliche Rechnung wird vollständig storniert.</p>` : '';

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 20mm 18mm 24mm 18mm; }
  * { box-sizing: border-box; }
  html, body { font-family: "DejaVu Sans", Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.4; margin: 0; }
  .watermark { position: fixed; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
    font-size: 90pt; color: rgba(200,0,0,0.12); font-weight: bold; letter-spacing: 6px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; }
  .logo { max-height: 22mm; max-width: 55mm; }
  .seller-head { text-align: right; font-size: 9pt; color: #444; }
  .seller-head .name { font-size: 11pt; color: #111; font-weight: bold; }
  .addr-row { display: flex; justify-content: space-between; margin: 6mm 0; }
  .sender-line { font-size: 7.5pt; color: #666; border-bottom: 0.3pt solid #999; padding-bottom: 1mm; margin-bottom: 2mm; }
  .customer { max-width: 85mm; }
  .meta { font-size: 9pt; }
  .meta div { margin-bottom: 0.5mm; }
  h1 { font-size: 16pt; margin: 4mm 0 2mm; letter-spacing: 1px; }
  table.items { width: 100%; border-collapse: collapse; margin: 4mm 0; }
  table.items th { text-align: left; border-bottom: 1pt solid #333; padding: 1.5mm 2mm; font-size: 9pt; }
  table.items td { padding: 1.6mm 2mm; vertical-align: top; border-bottom: 0.3pt solid #ddd; }
  table.items tr { page-break-inside: avoid; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.pos { width: 8mm; color: #666; }
  td.unit { white-space: nowrap; }
  .rights { font-size: 8pt; color: #555; margin-top: 0.8mm; font-style: italic; }
  .disc { font-size: 8pt; color: #a00; }
  .total-box { margin-top: 3mm; display: flex; justify-content: flex-end; }
  .total-box .inner { min-width: 70mm; }
  .total-line { display: flex; justify-content: space-between; padding: 2mm 2mm; border-top: 1.2pt solid #333;
    font-weight: bold; font-size: 12pt; }
  .tax-note { margin: 5mm 0; padding: 2.5mm 3mm; background: #f5f5f5; border-left: 2pt solid #888; font-size: 9.5pt; }
  .storno-note { color: #a00; font-size: 9.5pt; }
  .pay { margin-top: 6mm; font-size: 9.5pt; }
  .bank { margin-top: 2mm; font-size: 9pt; }
  .thanks { margin-top: 6mm; font-size: 9.5pt; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 7.5pt; color: #666;
    border-top: 0.3pt solid #ccc; padding-top: 1.5mm; display: flex; justify-content: space-between; }
</style></head>
<body>
  ${watermark}
  <header>
    <div>${s.logo_url ? `<img class="logo" src="${esc(s.logo_url)}">` : `<div class="seller-head"><div class="name">${esc(sellerLine1)}</div></div>`}</div>
    <div class="seller-head">
      <div class="name">${esc(sellerLine1)}</div>
      <div>${esc(s.street)}</div>
      <div>${esc(s.postal_code)} ${esc(s.city)}</div>
      ${s.phone ? `<div>Tel: ${esc(s.phone)}</div>` : ''}
      <div>${esc(s.email)}</div>
      ${s.website ? `<div>${esc(s.website)}</div>` : ''}
      ${s.steuernummer ? `<div>Steuernr.: ${esc(s.steuernummer)}</div>` : ''}
      ${s.ust_idnr ? `<div>USt-IdNr.: ${esc(s.ust_idnr)}</div>` : ''}
    </div>
  </header>

  <div class="addr-row">
    <div class="customer">
      <div class="sender-line">${esc(sellerLine1)} · ${esc(s.street)} · ${esc(s.postal_code)} ${esc(s.city)}</div>
      <div><strong>${esc(custName)}</strong></div>
      ${c.contact_person ? `<div>z. Hd. ${esc(c.contact_person)}</div>` : ''}
      ${c.street ? `<div>${esc(c.street)}</div>` : ''}
      <div>${esc(c.postal_code)} ${esc(c.city)}</div>
      ${c.country && c.country !== 'DE' ? `<div>${esc(c.country)}</div>` : ''}
      ${c.ust_idnr ? `<div>USt-IdNr.: ${esc(c.ust_idnr)}</div>` : ''}
    </div>
    <div class="meta">
      <div><strong>${DE_LABELS.rechnungsnummer}:</strong> ${esc(d.invoiceNumber)}</div>
      <div><strong>${DE_LABELS.rechnungsdatum}:</strong> ${formatDateDe(d.invoiceDate)}</div>
      <div><strong>${DE_LABELS.kundennummer}:</strong> ${esc(d.customerCode)}</div>
      <div>${serviceInfo}</div>
      ${d.projectName ? `<div><strong>${DE_LABELS.projekt}:</strong> ${esc(d.projectName)}</div>` : ''}
      ${d.projectNumber ? `<div><strong>Projekt-Nr.:</strong> ${esc(d.projectNumber)}</div>` : ''}
      ${d.orderReference ? `<div><strong>${DE_LABELS.bestellnummer}:</strong> ${esc(d.orderReference)}</div>` : ''}
      ${d.buyerReference ? `<div><strong>Leitweg-ID / Buyer Ref.:</strong> ${esc(d.buyerReference)}</div>` : ''}
    </div>
  </div>

  <h1>${heading(d.documentType)}</h1>
  ${stornoNote}

  <table class="items">
    <thead><tr>
      <th class="pos">${DE_LABELS.pos}</th>
      <th>${DE_LABELS.beschreibung}</th>
      <th class="num">${DE_LABELS.menge}</th>
      <th>${DE_LABELS.einheit}</th>
      <th class="num">${DE_LABELS.einzelpreis}</th>
      <th class="num">${DE_LABELS.betrag}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="total-box"><div class="inner">
    <div class="total-line"><span>${DE_LABELS.rechnungsbetrag}</span><span>${formatMoneyLatin(d.totalCents, cur)}</span></div>
  </div></div>

  <div class="tax-note">${esc(d.taxExemptionText)}</div>

  <div class="pay">
    <div><strong>${DE_LABELS.faelligkeit}:</strong> ${formatDateDe(d.dueDate)}</div>
    ${d.paymentTermsText ? `<div>${esc(d.paymentTermsText)}</div>` : ''}
    ${bankBlock}
  </div>

  ${d.thanksText ? `<div class="thanks">${esc(d.thanksText)}</div>` : ''}

  <footer>
    <span>${esc(sellerLine1)}</span>
    <span>${esc(s.iban)}</span>
    <span>${esc(d.invoiceNumber)}</span>
  </footer>
</body></html>`;
}
