/**
 * Unified invoice template — German / English / Persian (RTL).
 *
 * Visual design follows the supplied reference: a thin accent bar at the top,
 * a bold display heading of the business name, small-caps meta labels, a
 * striped line-item table, a large total, and a right-aligned contact/bank
 * footer block. Amounts use per-currency formatting (EUR cents, Rial/Toman,
 * or the redenominated unit with «قران»); Persian output uses Persian digits.
 *
 * Kleinunternehmer §19: when no VAT rows are supplied, only a single total is
 * shown plus the §19/exemption note — never a "0 % MwSt." line.
 */
import { formatMoney, formatMoneyLatin, formatDateDe, toPersianDigits } from '../../lib/format';
import type { DocumentType } from '../../config/constants';
import { persianFontFaceCss } from './fonts';

export type Lang = 'de' | 'en' | 'fa';

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

export interface TemplateInstallment {
  label?: string | null;
  dueDate?: string | null;
  amountCents: number;
  paid?: boolean;
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
  /** Sum of line totals (before document discount / VAT). */
  subtotalCents?: number;
  /** Document-level discount. */
  discountCents?: number;
  /** Net = subtotal − discount. */
  netCents?: number;
  /** VAT rate in basis points (1900 = 19%); 0 = tax-free. */
  taxRateBp?: number;
  /** VAT amount. */
  taxCents?: number;
  /** Gross total. */
  totalCents: number;
  /** Prepaid advance (Anzahlung). */
  advancePaidCents?: number;
  /** total − advance. */
  amountDueCents?: number;
  installments?: TemplateInstallment[];
  taxExemptionText: string;
  paymentTermsText: string | null;
  thanksText: string | null;
  showBank: boolean;
  draft: boolean;
  language?: Lang;
  /** Accent/brand colour (default bright yellow, like the reference). */
  accentColor?: string;
  /** Bold display heading; defaults to business name / full name. */
  brandHeading?: string;
  /** Custom uploaded invoice font (data URLs); overrides Vazirmatn for Persian. */
  customFont?: { family?: string; regularDataUrl?: string; boldDataUrl?: string };
}

interface Labels {
  title: Record<DocumentType, string>;
  draft: string;
  greeting: string;
  intro: string;
  colService: string;
  colScope: string;
  colPrice: string;
  colTotal: string;
  subtotal: string;
  total: string;
  discount: string;
  net: string;
  vat: (ratePct: string) => string;
  advance: string;
  amountDue: string;
  planTitle: string;
  planDue: string;
  planAmount: string;
  planPaid: string;
  metaNumber: string;
  metaDate: string;
  metaDelivery: string;
  metaCustomer: string;
  metaContact: string;
  payment: (due: string) => string;
  regards: string;
  fon: string; mail: string; web: string;
  bank: string; iban: string; bic: string;
  taxNo: string; vatId: string; nationalId: string; economicCode: string; taxMemory: string;
  pricePrefix: string;
  units: Record<string, string>;
}

const L: Record<Lang, Labels> = {
  de: {
    title: { RECHNUNG: 'Rechnung', STORNORECHNUNG: 'Stornorechnung', GUTSCHRIFT: 'Gutschrift' },
    draft: 'ENTWURF',
    greeting: 'Sehr geehrte Damen und Herren,',
    intro: 'vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen! Hiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:',
    colService: 'Leistung', colScope: 'Umfang', colPrice: 'Preis', colTotal: 'Gesamt',
    subtotal: 'Zwischensumme', total: 'Gesamtbetrag',
    discount: 'Rabatt', net: 'Nettobetrag', vat: (p) => `zzgl. ${p}% USt`, advance: 'abzügl. Anzahlung', amountDue: 'Zahlbetrag',
    planTitle: 'Zahlungsplan', planDue: 'Fällig', planAmount: 'Betrag', planPaid: 'Bezahlt',
    metaNumber: 'Rechnungsnr', metaDate: 'Datum', metaDelivery: 'Leistungsdatum', metaCustomer: 'Kundennr', metaContact: 'Ansprechpartner',
    payment: (d) => `Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene Konto. Der Rechnungsbetrag ist zahlbar bis ${d}.`,
    regards: 'Mit freundlichen Grüßen',
    fon: 'Fon', mail: 'Mail', web: 'Web', bank: 'Bank', iban: 'IBAN', bic: 'BIC', taxNo: 'St-Nr', vatId: 'USt-IdNr', nationalId: 'Nat. ID (IR)', economicCode: 'Wirtschaftscode (IR)', taxMemory: 'Steuerspeicher-ID',
    pricePrefix: 'à ',
    units: { Stunde: 'Std.', Tag: 'Tag', Pauschale: 'Pauschale', Stück: 'Stück', Kilometer: 'km', Projekt: 'Projekt', Minute: 'Min.' },
  },
  en: {
    title: { RECHNUNG: 'Invoice', STORNORECHNUNG: 'Credit / Cancellation', GUTSCHRIFT: 'Credit note' },
    draft: 'DRAFT',
    greeting: 'Dear Sir or Madam,',
    intro: 'thank you very much for your order and your trust. I hereby invoice you for the following services:',
    colService: 'Service', colScope: 'Quantity', colPrice: 'Price', colTotal: 'Total',
    subtotal: 'Subtotal', total: 'Total amount',
    discount: 'Discount', net: 'Net amount', vat: (p) => `VAT ${p}%`, advance: 'less advance payment', amountDue: 'Amount due',
    planTitle: 'Payment schedule', planDue: 'Due', planAmount: 'Amount', planPaid: 'Paid',
    metaNumber: 'Invoice no', metaDate: 'Date', metaDelivery: 'Service date', metaCustomer: 'Customer no', metaContact: 'Contact',
    payment: (d) => `Please transfer the invoice amount, quoting the invoice number, to the account below. Payment is due by ${d}.`,
    regards: 'Kind regards',
    fon: 'Phone', mail: 'Mail', web: 'Web', bank: 'Bank', iban: 'IBAN', bic: 'BIC', taxNo: 'Tax no', vatId: 'VAT ID', nationalId: 'National ID (IR)', economicCode: 'Economic code (IR)', taxMemory: 'Tax memory ID',
    pricePrefix: '@ ',
    units: { Stunde: 'h', Tag: 'day', Pauschale: 'flat', Stück: 'pc', Kilometer: 'km', Projekt: 'project', Minute: 'min' },
  },
  fa: {
    title: { RECHNUNG: 'فاکتور فروش', STORNORECHNUNG: 'فاکتور برگشتی', GUTSCHRIFT: 'بستانکاری' },
    draft: 'پیش‌نویس',
    greeting: 'با سلام و احترام،',
    intro: 'با تشکر از سفارش و اعتماد شما؛ بدین‌وسیله خدمات زیر صورتحساب می‌شود:',
    colService: 'شرح خدمات', colScope: 'مقدار', colPrice: 'قیمت واحد', colTotal: 'جمع',
    subtotal: 'جمع جزء', total: 'مبلغ کل',
    discount: 'تخفیف', net: 'مبلغ خالص', vat: (p) => `مالیات بر ارزش افزوده ${p}٪`, advance: 'کسر پیش‌پرداخت', amountDue: 'مبلغ قابل پرداخت',
    planTitle: 'برنامهٔ پرداخت اقساط', planDue: 'سررسید', planAmount: 'مبلغ', planPaid: 'پرداخت‌شده',
    metaNumber: 'شماره فاکتور', metaDate: 'تاریخ', metaDelivery: 'تاریخ خدمت', metaCustomer: 'شماره مشتری', metaContact: 'طرف حساب',
    payment: (d) => `لطفاً مبلغ فاکتور را با ذکر شماره فاکتور به حساب زیر واریز کنید. مهلت پرداخت تا ${d} است.`,
    regards: 'با احترام',
    fon: 'تلفن', mail: 'ایمیل', web: 'وب', bank: 'بانک', iban: 'شبا', bic: 'شناسه بانک', taxNo: 'شماره مالیاتی (آلمان)', vatId: 'شناسه ارزش افزوده (اروپا)', nationalId: 'شناسه/کد ملی', economicCode: 'کد اقتصادی', taxMemory: 'شناسه حافظه مالیاتی',
    pricePrefix: '',
    units: { Stunde: 'ساعت', Tag: 'روز', Pauschale: 'مقطوع', Stück: 'عدد', Kilometer: 'کیلومتر', Projekt: 'پروژه', Minute: 'دقیقه' },
  },
};

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderInvoiceHtml(d: TemplateData): string {
  const lang: Lang = d.language ?? 'de';
  const rtl = lang === 'fa';
  const t = L[lang];
  const accent = d.accentColor || '#F2EA00';
  const cur = d.currency;
  const iranCur = ['IRR', 'IRT', 'IRT_NEW'].includes(cur);
  const s = d.seller;
  const c = d.customer;

  const money = (n: number) => (lang === 'fa' ? formatMoney(n, cur) : formatMoneyLatin(n, cur));
  const fdate = (iso: string | null | undefined) => (lang === 'fa' ? toPersianDigits(formatDateDe(iso)) : formatDateDe(iso));
  const num = (x: string) => (lang === 'fa' ? toPersianDigits(x) : x);

  const brand = d.brandHeading || (s.business_name as string) || (s.full_name as string) || '';
  const sellerName = [s.full_name, s.business_name].filter(Boolean).join(' · ');
  const custName = (c.company_name as string) || (c.name as string) || '';

  const serviceValue = d.servicePeriodStart && d.servicePeriodEnd
    ? `${fdate(d.servicePeriodStart)} – ${fdate(d.servicePeriodEnd)}`
    : fdate(d.serviceDate || d.invoiceDate);

  const unitLabel = (u: string) => t.units[u] ?? u;

  const rows = d.items.map((it) => {
    const scope = `${num(it.quantity)} ${esc(unitLabel(it.unit))}`;
    const rights = it.rightsText ? `<div class="rights">${esc(it.rightsText)}</div>` : '';
    const disc = it.discountCents ? `<div class="disc">− ${money(it.discountCents)}</div>` : '';
    return `<tr class="item">
      <td class="pos">${num(String(it.position))}.</td>
      <td class="svc">${esc(it.description)}${rights}</td>
      <td class="scope">${scope}</td>
      <td class="price">${t.pricePrefix}${money(it.unitPriceCents)}</td>
      <td class="amt">${money(it.lineTotalCents)}${disc}</td>
    </tr>`;
  }).join('');

  const subtotal = d.subtotalCents ?? d.totalCents;
  const discount = d.discountCents ?? 0;
  const net = d.netCents ?? subtotal;
  const taxBp = d.taxRateBp ?? 0;
  const tax = d.taxCents ?? 0;
  const advance = d.advancePaidCents ?? 0;
  const amountDue = d.amountDueCents ?? d.totalCents;
  const hasBreakdown = discount > 0 || tax > 0;

  // Summary rows shown above the big total (Zwischensumme / Rabatt / USt …).
  const summaryRows: string[] = [];
  if (hasBreakdown) {
    summaryRows.push(`<tr class="sum"><td colspan="4">${esc(t.subtotal)}</td><td class="amt">${money(subtotal)}</td></tr>`);
    if (discount > 0) summaryRows.push(`<tr class="sum"><td colspan="4">${esc(t.discount)}</td><td class="amt">− ${money(discount)}</td></tr>`);
    if (tax > 0) {
      summaryRows.push(`<tr class="sum"><td colspan="4">${esc(t.net)}</td><td class="amt">${money(net)}</td></tr>`);
      const ratePct = num((taxBp / 100).toString().replace('.', lang === 'de' ? ',' : '.'));
      summaryRows.push(`<tr class="sum"><td colspan="4">${esc(t.vat(ratePct))}</td><td class="amt">${money(tax)}</td></tr>`);
    }
  }

  const metaRow = (label: string, value: string) => value
    ? `<div class="meta-row"><span class="meta-k">${esc(label)}</span><span class="meta-v">${esc(value)}</span></div>` : '';

  const footLine = (label: string, value: unknown) => value
    ? `<div class="f-row"><span class="f-k">${esc(label)}</span><span class="f-v">${esc(value)}</span></div>` : '';

  // Advance + amount-due lines (only when there is an advance payment).
  const dueBlock = advance > 0
    ? `<div class="total sub"><span class="lbl">${esc(t.advance)}</span><span class="val-sm">− ${money(advance)}</span></div>
       <div class="total due"><span class="lbl">${esc(t.amountDue)}</span><span class="val">${money(amountDue)}</span></div>`
    : '';

  // Installment schedule (Zahlungsplan / برنامهٔ پرداخت اقساط).
  const installments = d.installments ?? [];
  const planBlock = installments.length
    ? `<div class="plan">
        <div class="plan-title">${esc(t.planTitle)}</div>
        <table class="plan-table"><thead><tr>
          <th>#</th><th>${esc(t.planDue)}</th><th class="amt">${esc(t.planAmount)}</th><th>${esc(t.planPaid)}</th>
        </tr></thead><tbody>
        ${installments.map((p, i) => `<tr>
          <td>${num(String(i + 1))}</td>
          <td>${fdate(p.dueDate)}${p.label ? ` · ${esc(p.label)}` : ''}</td>
          <td class="amt">${money(p.amountCents)}</td>
          <td>${p.paid ? '✓' : '—'}</td>
        </tr>`).join('')}
        </tbody></table>
      </div>`
    : '';

  const taxNote = d.taxExemptionText ? `<div class="tax-note">${esc(d.taxExemptionText)}</div>` : '';
  const watermark = d.draft ? `<div class="watermark">${esc(t.draft)}</div>` : '';

  // Persian default font = embedded Vazirmatn (or an uploaded custom font).
  const fontFamily = d.customFont?.family || 'Vazirmatn';
  const fontFaces = rtl ? persianFontFaceCss(d.customFont) : '';
  const bodyFont = rtl
    ? `'${fontFamily}', 'Noto Sans Arabic', Tahoma, Arial, sans-serif`
    : `'Helvetica Neue', Arial, 'Noto Sans', sans-serif`;

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  ${fontFaces}
  * { box-sizing: border-box; }
  :root { --accent: ${accent}; --ink: #141414; --muted: #6b6b6b; --line: #e6e6e6; --stripe: #f5f1e6; }
  html, body { margin: 0; color: var(--ink); font-size: 10.5pt; line-height: 1.5;
    font-family: ${bodyFont}; }
  .bar { height: 10px; background: var(--accent); }
  .page { padding: 16mm 16mm 14mm; position: relative; }
  .watermark { position: fixed; top: 44%; left: 0; right: 0; text-align: center;
    font-size: 92pt; font-weight: 800; color: rgba(190,0,0,0.10); letter-spacing: 8px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; }
  .brand { font-weight: 800; font-size: 20pt; line-height: 1.05; letter-spacing: -0.01em; max-width: 68mm;
    text-align: ${rtl ? 'right' : 'left'}; }
  .sender-sm { font-weight: 700; font-size: 8pt; color: var(--ink); margin-top: 10mm; }
  .recipient { margin-top: 3mm; color: #3a3a3a; }
  .recipient .name { color: var(--ink); font-weight: 600; }
  .headline-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14mm; gap: 10mm; }
  h1 { font-size: 26pt; font-weight: 800; margin: 0; letter-spacing: -0.015em; }
  .meta { min-width: 56mm; }
  .meta-row { display: flex; gap: 4mm; justify-content: space-between; font-size: 8.5pt; margin-bottom: 1mm; }
  .meta-k { text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-size: 7.5pt; }
  .meta-v { font-weight: 700; }
  .intro { margin: 9mm 0 4mm; max-width: 125mm; }
  .intro .g { margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  thead th { font-weight: 700; font-size: 9.5pt; padding: 2mm 3mm; border-bottom: 1.5pt solid var(--ink);
    text-align: ${rtl ? 'right' : 'left'}; }
  th.price, th.amt, td.price, td.amt, th.scope, td.scope { text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; }
  tbody td { padding: 2.4mm 3mm; vertical-align: top; }
  tr.item:nth-child(odd) td { background: var(--stripe); }
  tr.item td { border: none; }
  td.pos { width: 8mm; color: var(--muted); }
  tr.sum td { background: var(--stripe); padding: 2.2mm 3mm; }
  .rights { font-size: 8pt; color: #555; margin-top: 0.8mm; font-style: italic; }
  .disc { font-size: 8pt; color: #a00; }
  .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5mm;
    padding: 2mm 3mm; border-top: 2pt solid var(--ink); }
  .total.sub { margin-top: 0; padding-top: 1.5mm; padding-bottom: 1mm; border-top: none; }
  .total.due { margin-top: 0; border-top: 1pt solid var(--ink); }
  .total .lbl { font-weight: 700; font-size: 11pt; }
  .total .val { font-weight: 800; font-size: 20pt; }
  .total .val-sm { font-weight: 700; font-size: 11pt; color: #a00; }
  .plan { margin-top: 6mm; }
  .plan-title { font-weight: 700; font-size: 10pt; margin-bottom: 1.5mm; }
  .plan-table { width: 100%; border-collapse: collapse; }
  .plan-table th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
    padding: 1.4mm 2mm; border-bottom: 1pt solid var(--ink); text-align: ${rtl ? 'right' : 'left'}; }
  .plan-table td { padding: 1.6mm 2mm; border-bottom: 0.3pt solid var(--line); font-size: 9.5pt; }
  .plan-table .amt { text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; }
  .tax-note { white-space: pre-line; margin: 5mm 0; padding: 2.5mm 3mm; background: #faf8f0; border-${rtl ? 'right' : 'left'}: 2.5pt solid var(--accent); font-size: 9.5pt; }
  .pay { margin-top: 7mm; max-width: 125mm; }
  .regards { margin-top: 8mm; }
  /* Footer block: right for LTR, LEFT for Persian (RTL flex-end resolves left). */
  .footer { margin-top: 12mm; display: flex; justify-content: flex-end; }
  .footer .cols { font-size: 8.5pt; min-width: 72mm; }
  .footer .addr { font-weight: 700; margin-bottom: 2mm; }
  .f-row { display: flex; gap: 3mm; margin-bottom: 0.6mm; }
  .f-k { text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-size: 7.5pt; min-width: 14mm; }
  .f-v { font-weight: 700; }
  .f-gap { height: 2.5mm; }
</style></head>
<body>
  <div class="bar"></div>
  ${watermark}
  <div class="page">
    <div class="top">
      <div>
        <div class="sender-sm">${esc(sellerName)} · ${esc(s.street)} · ${esc(s.postal_code)} ${esc(s.city)}</div>
        <div class="recipient">
          <div class="name">${esc(custName)}</div>
          ${c.contact_person ? `<div>${rtl ? 'جناب/سرکار ' : 'z. Hd. '}${esc(c.contact_person)}</div>` : ''}
          ${c.street ? `<div>${esc(c.street)}</div>` : ''}
          <div>${esc(c.postal_code)} ${esc(c.city)}</div>
          ${c.country && c.country !== 'DE' ? `<div>${esc(c.country)}</div>` : ''}
          ${c.ust_idnr ? `<div>${t.vatId}: ${esc(c.ust_idnr)}</div>` : ''}
          ${c.national_id ? `<div>${t.nationalId}: ${esc(num(String(c.national_id)))}</div>` : ''}
          ${c.economic_code ? `<div>${t.economicCode}: ${esc(num(String(c.economic_code)))}</div>` : ''}
          ${c.email ? `<div>${esc(c.email)}</div>` : ''}
        </div>
      </div>
      <div class="brand">${esc(brand)}</div>
    </div>

    <div class="headline-row">
      <h1>${t.title[d.documentType]} ${esc(d.invoiceNumber)}</h1>
      <div class="meta">
        ${metaRow(t.metaNumber, d.invoiceNumber)}
        ${metaRow(t.metaDate, fdate(d.invoiceDate))}
        ${metaRow(t.metaDelivery, serviceValue)}
        ${metaRow(t.metaCustomer, d.customerCode)}
        ${metaRow(t.metaContact, (s.full_name as string) ?? '')}
        ${d.projectName ? metaRow(rtl ? 'پروژه' : lang === 'en' ? 'Project' : 'Projekt', d.projectName) : ''}
        ${d.orderReference ? metaRow(rtl ? 'شماره سفارش' : lang === 'en' ? 'Order no' : 'Bestellnr', d.orderReference) : ''}
      </div>
    </div>

    <div class="intro">
      <div class="g">${esc(t.greeting)}</div>
      <div>${esc(t.intro)}</div>
    </div>

    <table>
      <thead><tr>
        <th class="pos"></th>
        <th class="svc">${t.colService}</th>
        <th class="scope">${t.colScope}</th>
        <th class="price">${t.colPrice}</th>
        <th class="amt">${t.colTotal}</th>
      </tr></thead>
      <tbody>
        ${rows}
        ${summaryRows.join('')}
      </tbody>
    </table>

    <div class="total">
      <span class="lbl">${t.total}</span>
      <span class="val">${money(d.totalCents)}</span>
    </div>
    ${dueBlock}

    ${taxNote}
    ${planBlock}

    <div class="pay">${esc(t.payment(fdate(d.dueDate)))}</div>
    ${d.thanksText ? `<div class="pay">${esc(d.thanksText)}</div>` : ''}

    <div class="regards">${esc(t.regards)}<br>${esc(s.full_name)}</div>

    <div class="footer"><div class="cols">
      <div class="addr">${esc(s.street)}<br>${esc(s.postal_code)} ${esc(s.city)}</div>
      ${footLine(t.fon, s.phone)}
      ${footLine(t.mail, s.email)}
      ${footLine(t.web, s.website)}
      <div class="f-gap"></div>
      ${footLine(t.bank, s.bank_name)}
      ${footLine(t.iban, s.iban)}
      ${footLine(t.bic, s.bic)}
      <div class="f-gap"></div>
      ${footLine(t.taxNo, s.steuernummer)}
      ${footLine(t.vatId, s.ust_idnr)}
      ${iranCur ? footLine(t.nationalId, s.national_id) : ''}
      ${iranCur ? footLine(t.economicCode, s.economic_code) : ''}
      ${iranCur ? footLine(t.taxMemory, s.tax_memory_id) : ''}
    </div></div>
  </div>
</body></html>`;
}
