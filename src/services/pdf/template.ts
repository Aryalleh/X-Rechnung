/**
 * Unified invoice template — German / English / Persian (RTL).
 *
 * Layout is sized for A4: accent bar, brand + document title, recipient beside
 * the meta table, a striped line-item table, notes/payment plan beside the
 * totals box, and a 3-column footer (contact · bank · tax IDs) pinned to the
 * bottom of the page. Bank details follow the currency: German IBAN/BIC on EUR
 * invoices, Iranian Sheba (+ card no.) on IRR/IRT invoices. Amounts use per-currency formatting (EUR cents, Rial/Toman,
 * or the redenominated unit with «قران»); Persian output uses Persian digits.
 *
 * Kleinunternehmer §19: when no VAT rows are supplied, only a single total is
 * shown plus the §19/exemption note — never a "0 % MwSt." line.
 */
import { formatMoneyFor, formatDateFor, amountInWordsFa, toPersianDigits } from '../../lib/format';
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
  contractReference?: string | null;
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
  /** Payment sentence when no bank account is printed. */
  paymentNoBank: (due: string) => string;
  regards: string;
  fon: string; mail: string; web: string;
  bank: string; iban: string; bic: string; shaba: string; holder: string; card: string;
  contactHead: string; bankHead: string; taxHead: string;
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
    paymentNoBank: (d) => `Der Rechnungsbetrag ist zahlbar bis ${d}.`,
    regards: 'Mit freundlichen Grüßen',
    contactHead: 'Kontakt', bankHead: 'Bankverbindung', taxHead: 'Steuer',
    fon: 'Fon', mail: 'Mail', web: 'Web', bank: 'Bank', iban: 'IBAN', bic: 'BIC', shaba: 'Sheba', holder: 'Inhaber', card: 'Karte', taxNo: 'St-Nr', vatId: 'USt-IdNr', nationalId: 'Nat. ID (IR)', economicCode: 'Wirtschaftscode (IR)', taxMemory: 'Steuerspeicher-ID',
    pricePrefix: 'à ',
    units: { Stunde: 'Std.', Tag: 'Tag', Pauschale: 'Pauschale', Stück: 'Stück', Kilometer: 'km', Projekt: 'Projekt', Minute: 'Min.' },
  },
  en: {
    title: { RECHNUNG: 'Invoice', STORNORECHNUNG: 'Credit / Cancellation', GUTSCHRIFT: 'Credit note' },
    draft: 'DRAFT',
    greeting: 'Dear Sir or Madam,',
    intro: 'Thank you very much for your order and your trust. I hereby invoice you for the following services:',
    colService: 'Service', colScope: 'Quantity', colPrice: 'Price', colTotal: 'Total',
    subtotal: 'Subtotal', total: 'Total amount',
    discount: 'Discount', net: 'Net amount', vat: (p) => `VAT ${p}%`, advance: 'less advance payment', amountDue: 'Amount due',
    planTitle: 'Payment schedule', planDue: 'Due', planAmount: 'Amount', planPaid: 'Paid',
    metaNumber: 'Invoice no', metaDate: 'Date', metaDelivery: 'Service date', metaCustomer: 'Customer no', metaContact: 'Contact',
    payment: (d) => `Please transfer the invoice amount, quoting the invoice number, to the account below. Payment is due by ${d}.`,
    paymentNoBank: (d) => `Payment is due by ${d}.`,
    regards: 'Kind regards',
    contactHead: 'Contact', bankHead: 'Bank details', taxHead: 'Tax',
    fon: 'Phone', mail: 'Mail', web: 'Web', bank: 'Bank', iban: 'IBAN', bic: 'BIC', shaba: 'Sheba', holder: 'Holder', card: 'Card', taxNo: 'Tax no', vatId: 'VAT ID', nationalId: 'National ID (IR)', economicCode: 'Economic code (IR)', taxMemory: 'Tax memory ID',
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
    paymentNoBank: (d) => `مهلت پرداخت تا ${d} است.`,
    regards: 'با احترام',
    contactHead: 'تماس', bankHead: 'اطلاعات حساب', taxHead: 'شناسه‌های مالیاتی',
    fon: 'تلفن', mail: 'ایمیل', web: 'وب', bank: 'بانک', iban: 'IBAN', bic: 'BIC', shaba: 'شبا', holder: 'صاحب حساب', card: 'شماره کارت', taxNo: 'شماره مالیاتی (آلمان)', vatId: 'شناسه ارزش افزوده (اروپا)', nationalId: 'شناسه/کد ملی', economicCode: 'کد اقتصادی', taxMemory: 'شناسه حافظه مالیاتی',
    pricePrefix: '',
    units: { Stunde: 'ساعت', Tag: 'روز', Pauschale: 'مقطوع', Stück: 'عدد', Kilometer: 'کیلومتر', Projekt: 'پروژه', Minute: 'دقیقه' },
  },
};

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/** "DE89370400440532013000" → "DE89 3704 0044 0532 0130 00" (IBAN / Sheba print form). */
export function groupAccount(v: string): string {
  return v.replace(/\s/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Bank block for the footer. EUR (and any non-Iranian currency) → German
 * IBAN/BIC; IRR/IRT → Iranian Sheba + card number. Never mixes the two: a
 * toman invoice must not ask for a transfer to a German account and vice versa.
 */
export function bankLines(seller: Record<string, unknown>, iranCur: boolean): { key: 'holder' | 'bank' | 'iban' | 'bic' | 'shaba' | 'card'; value: string; ltr?: boolean }[] {
  const str = (k: string) => (typeof seller[k] === 'string' ? (seller[k] as string).trim() : '');
  const out: { key: 'holder' | 'bank' | 'iban' | 'bic' | 'shaba' | 'card'; value: string; ltr?: boolean }[] = [];
  if (iranCur) {
    const shaba = str('shaba');
    if (!shaba) return [];
    const holder = str('iran_account_holder') || str('full_name');
    if (holder) out.push({ key: 'holder', value: holder });
    if (str('iran_bank_name')) out.push({ key: 'bank', value: str('iran_bank_name') });
    out.push({ key: 'shaba', value: groupAccount(shaba), ltr: true });
    const card = str('iran_card_number').replace(/\D/g, '');
    if (card) out.push({ key: 'card', value: card.replace(/(\d{4})(?=\d)/g, '$1 '), ltr: true });
    return out;
  }
  const iban = str('iban');
  if (!iban) return [];
  const holder = str('account_holder') || str('full_name');
  if (holder) out.push({ key: 'holder', value: holder });
  if (str('bank_name')) out.push({ key: 'bank', value: str('bank_name') });
  out.push({ key: 'iban', value: groupAccount(iban), ltr: true });
  if (str('bic')) out.push({ key: 'bic', value: str('bic'), ltr: true });
  return out;
}

/*
 * A4 height budget (297 mm). Page 1 has no top page-margin so the accent bar
 * bleeds to the edge; every page keeps a 12 mm bottom margin, later pages a
 * 14 mm top margin. Usable height on page 1 = 285 mm:
 *
 *   bar 2.5 + head 9+15 ......................... ~27 mm
 *   parties (recipient | meta) ................... ~34 mm
 *   intro (greeting + 2 lines) ................... ~14 mm
 *   table head ~7 mm + ~6.5 mm per single-line item
 *   notes+plan+regards | totals, side by side .... ~45 mm
 *   footer, 3 columns (contact | bank | tax) ..... ~30 mm
 *                                                 ≈ 150 mm + items
 *
 * → about 15 single-line items still fit on one page. Longer invoices flow
 * onto further pages: the table header repeats, rows never split, and the
 * totals / footer blocks are kept whole.
 */
export function renderInvoiceHtml(d: TemplateData): string {
  const lang: Lang = d.language ?? 'de';
  const rtl = lang === 'fa';
  const t = L[lang];
  const accent = d.accentColor || '#F2EA00';
  const cur = d.currency;
  const iranCur = ['IRR', 'IRT', 'IRT_NEW'].includes(cur);
  const s = d.seller;
  const c = d.customer;

  // Every currency is written in the invoice LANGUAGE's conventions
  // (de 1.250,00 € · en €1,250.00 · fa ۱٬۲۵۰٫۰۰ یورو); Persian dates are Shamsi.
  const money = (n: number) => formatMoneyFor(n, cur, lang);
  const fdate = (iso: string | null | undefined) => formatDateFor(iso, lang);
  const num = (x: string) => (lang === 'fa' ? toPersianDigits(x) : x);

  const brand = d.brandHeading || (s.business_name as string) || (s.full_name as string) || '';
  const sellerName = [s.full_name, s.business_name].filter(Boolean).join(' · ');
  const custName = (c.company_name as string) || (c.name as string) || '';

  const serviceValue = d.servicePeriodStart && d.servicePeriodEnd
    ? `${fdate(d.servicePeriodStart)} – ${fdate(d.servicePeriodEnd)}`
    : fdate(d.serviceDate || d.invoiceDate);

  const unitLabel = (u: string) => t.units[u] ?? u;
  // Persian toman/rial sales invoice: the official Iranian document title.
  const docTitle = lang === 'fa' && iranCur && d.documentType === 'RECHNUNG' ? 'صورتحساب فروش کالا و خدمات' : t.title[d.documentType];

  // Quantity with the language's decimal mark: de 1,5 · en 1.5 · fa ۱٫۵
  const qty = (q: string) => num(q.replace(/[.,]/, lang === 'de' ? ',' : lang === 'fa' ? '٫' : '.'));
  const unitFor = (u: string, q: string) => {
    const label = unitLabel(u);
    const plural = lang === 'en' && Number(q.replace(',', '.')) !== 1 && (label === 'day' || label === 'project');
    return plural ? `${label}s` : label;
  };
  const rows = d.items.map((it) => {
    const scope = `${qty(it.quantity)} ${esc(unitFor(it.unit, it.quantity))}`;
    const rights = it.rightsText ? `<div class="rights">${esc(it.rightsText)}</div>` : '';
    const disc = it.discountCents ? `<div class="disc">− ${money(it.discountCents)}</div>` : '';
    return `<tr class="item">
      <td class="pos">${num(String(it.position))}</td>
      <td class="svc">${esc(it.description)}${rights}</td>
      <td class="num">${scope}</td>
      <td class="num">${t.pricePrefix}${money(it.unitPriceCents)}</td>
      <td class="num amt">${money(it.lineTotalCents)}${disc}</td>
    </tr>`;
  }).join('');

  const subtotal = d.subtotalCents ?? d.totalCents;
  const discount = d.discountCents ?? 0;
  const net = d.netCents ?? subtotal;
  const taxBp = d.taxRateBp ?? 0;
  const tax = d.taxCents ?? 0;
  const advance = d.advancePaidCents ?? 0;
  const amountDue = d.amountDueCents ?? d.totalCents;

  // Totals box (end side): Zwischensumme / Rabatt / Netto / USt → Gesamt → Anzahlung / Zahlbetrag.
  const sumRow = (label: string, value: string, cls = '') =>
    `<div class="t-row ${cls}"><span>${esc(label)}</span><span class="t-v">${value}</span></div>`;
  const totalsRows: string[] = [];
  if (discount > 0 || tax > 0) {
    totalsRows.push(sumRow(t.subtotal, money(subtotal)));
    if (discount > 0) totalsRows.push(sumRow(t.discount, `− ${money(discount)}`));
    if (tax > 0) {
      totalsRows.push(sumRow(t.net, money(net)));
      const ratePct = num((taxBp / 100).toString().replace('.', lang === 'de' ? ',' : lang === 'fa' ? '٫' : '.'));
      // Toman/rial invoices carry Iranian VAT, not German USt.
      const vatLabel = iranCur && lang !== 'fa' ? (lang === 'de' ? `zzgl. ${ratePct} % MwSt. (Iran)` : `VAT (Iran) ${ratePct}%`) : t.vat(ratePct);
      totalsRows.push(sumRow(vatLabel, money(tax)));
    }
  }
  totalsRows.push(`<div class="t-grand"><span>${esc(t.total)}</span><span class="t-v">${money(d.totalCents)}</span></div>`);
  // «مبلغ به حروف» — customary on Persian invoices (of the amount actually payable).
  const wordsBlock = lang === 'fa'
    ? `<div class="t-words"><span class="t-words-k">به حروف:</span> ${esc(amountInWordsFa(advance > 0 ? amountDue : d.totalCents, cur))}</div>` : '';
  if (advance > 0) {
    totalsRows.push(sumRow(t.advance, `− ${money(advance)}`, 'neg'));
    totalsRows.push(`<div class="t-due"><span>${esc(t.amountDue)}</span><span class="t-v">${money(amountDue)}</span></div>`);
  }

  const metaRow = (label: string, value: string) => value
    ? `<div class="m-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';

  // Footer columns. Bank + tax IDs follow the invoice currency (DE for EUR, IR for IRR/IRT).
  const fRow = (label: string, value: unknown, ltr = false) => value
    ? `<div class="f-row"><span class="f-k">${esc(label)}</span><span class="f-v">${ltr ? `<bdi dir="ltr">${esc(value)}</bdi>` : esc(value)}</span></div>` : '';
  const bank = d.showBank === false ? [] : bankLines(s, iranCur);
  const bankCol = bank.map((b) => fRow(t[b.key], b.value, b.ltr)).join('');
  const taxCol = iranCur
    ? [fRow(t.nationalId, s.national_id ? num(String(s.national_id)) : ''),
       fRow(t.economicCode, s.economic_code ? num(String(s.economic_code)) : ''),
       fRow(t.taxMemory, s.tax_memory_id, true)].join('')
    : [fRow(t.taxNo, s.steuernummer, true), fRow(t.vatId, s.ust_idnr, true)].join('');
  const contactCol = [
    `<div class="f-addr">${esc(sellerName)}</div><div class="f-line">${esc(s.street)}, ${esc(s.postal_code)} ${esc(s.city)}</div>`,
    fRow(t.fon, s.phone, true), fRow(t.mail, s.email, true), fRow(t.web, s.website, true),
  ].join('');
  const footCol = (head: string, body: string) => body
    ? `<div class="f-col"><div class="f-head">${esc(head)}</div>${body}</div>` : '';

  // Installment schedule (Zahlungsplan / برنامهٔ پرداخت اقساط).
  const installments = d.installments ?? [];
  const planBlock = installments.length
    ? `<div class="plan">
        <div class="sec-title">${esc(t.planTitle)}</div>
        <table class="plan-table"><thead><tr>
          <th class="pos">#</th><th>${esc(t.planDue)}</th><th class="num">${esc(t.planAmount)}</th><th class="paid">${esc(t.planPaid)}</th>
        </tr></thead><tbody>
        ${installments.map((p, i) => `<tr>
          <td class="pos">${num(String(i + 1))}</td>
          <td>${fdate(p.dueDate)}${p.label ? ` · ${esc(p.label)}` : ''}</td>
          <td class="num">${money(p.amountCents)}</td>
          <td class="paid">${p.paid ? '✓' : '—'}</td>
        </tr>`).join('')}
        </tbody></table>
      </div>`
    : '';

  const payText = bank.length ? t.payment(fdate(d.dueDate)) : t.paymentNoBank(fdate(d.dueDate));
  const notes = [
    d.taxExemptionText ? `<div class="tax-note">${esc(d.taxExemptionText)}</div>` : '',
    `<p class="pay">${esc(payText)}</p>`,
    d.thanksText ? `<p class="pay">${esc(d.thanksText)}</p>` : '',
    planBlock,
    `<div class="regards">${esc(t.regards)}<br><span class="who">${esc(s.full_name)}</span></div>`,
  ].join('');
  const watermark = d.draft ? `<div class="watermark">${esc(t.draft)}</div>` : '';

  // Persian default font = embedded Vazirmatn (or an uploaded custom font).
  const fontFamily = d.customFont?.family || 'Vazirmatn';
  const fontFaces = rtl ? persianFontFaceCss(d.customFont) : '';
  const bodyFont = rtl
    ? `'${fontFamily}', 'Noto Sans Arabic', Tahoma, Arial, sans-serif`
    : `'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif`;

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(docTitle)} ${esc(d.invoiceNumber)}</title>
<style>
  /* ── Page geometry (see height budget above renderInvoiceHtml) ── */
  @page { size: A4; margin: 14mm 0 12mm; }
  @page :first { margin-top: 0; }
  ${fontFaces}
  * { box-sizing: border-box; }
  :root { --accent: ${accent}; --ink: #16181d; --text: #2b2e35; --muted: #6a6f7a; --line: #dfe1e6; --stripe: #f6f6f3; }
  html, body { margin: 0; padding: 0; width: 210mm; }
  body { color: var(--text); font-family: ${bodyFont}; font-size: 9.5pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
  p { margin: 0; }

  /* Sheet: at least one full page tall so the footer sits at the bottom of a
     one-page invoice; grows naturally when content needs more pages. */
  .sheet { display: flex; flex-direction: column; min-height: 284mm; padding: 0 16mm; }
  .bar { height: 2.5mm; background: var(--accent); margin: 0 -16mm; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; pointer-events: none;
    font-size: 84pt; font-weight: 800; color: rgba(190,0,0,0.09); letter-spacing: 6px; transform: rotate(-18deg); }

  /* ── Head: brand (start) · document title (end) ── */
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm;
    padding: 8mm 0 3mm; border-bottom: 0.75pt solid var(--ink); }
  .brand { font-weight: 800; font-size: 17pt; line-height: 1.1; color: var(--ink); letter-spacing: -0.01em;
    max-width: 100mm; overflow-wrap: anywhere; }
  .brand-sub { font-size: 8.5pt; color: var(--muted); margin-top: 1mm; }
  .doc { text-align: end; flex-shrink: 0; }
  h1 { margin: 0; font-size: 19pt; line-height: 1.1; font-weight: 800; color: var(--ink); letter-spacing: -0.01em; }
  .doc-no { margin-top: 1mm; font-size: 10pt; font-weight: 700; color: var(--ink); }

  /* ── Parties: recipient (start) · meta (end) ── */
  .parties { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; margin-top: 5mm; }
  .to { flex: 1 1 auto; min-width: 0; }
  .sender-sm { font-size: 7pt; color: var(--muted); padding-bottom: 1mm; margin-bottom: 1.5mm;
    border-bottom: 0.5pt solid var(--line); display: inline-block; max-width: 100%; }
  .recipient { line-height: 1.4; overflow-wrap: anywhere; }
  .recipient .name { color: var(--ink); font-weight: 700; font-size: 10.5pt; }
  .meta { margin: 0; flex: 0 0 66mm; }
  .m-row { display: flex; justify-content: space-between; gap: 4mm; padding: 0.7mm 0; border-bottom: 0.5pt solid var(--line); }
  .m-row:last-child { border-bottom: none; }
  .meta dt { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); padding-top: 0.5mm; }
  .meta dd { margin: 0; font-weight: 700; color: var(--ink); font-size: 8.5pt; text-align: end; overflow-wrap: anywhere; }

  /* ── Intro ── */
  .intro { margin: 5mm 0 2.5mm; max-width: 140mm; line-height: 1.5; }
  .intro .g { margin-bottom: 1mm; }

  /* ── Line items ── */
  table { width: 100%; border-collapse: collapse; }
  .items thead { display: table-header-group; }
  .items th { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink);
    padding: 1.6mm 2.2mm; border-bottom: 1pt solid var(--ink); text-align: start; }
  .items td { padding: 1.5mm 2.2mm; vertical-align: top; line-height: 1.35; }
  .items tr { break-inside: avoid; page-break-inside: avoid; }
  .items tbody tr:nth-child(odd) td { background: var(--stripe); }
  .items tbody tr:last-child td { border-bottom: 0.75pt solid var(--line); }
  th.num, td.num { text-align: end; white-space: nowrap; }
  .pos { width: 7mm; color: var(--muted); }
  td.svc { overflow-wrap: anywhere; color: var(--ink); }
  td.amt { font-weight: 700; color: var(--ink); }
  .rights { font-size: 7.5pt; color: var(--muted); margin-top: 0.6mm; font-style: italic; }
  .disc { font-size: 7.5pt; color: #a40000; font-weight: 400; }

  /* ── Notes (start) · totals (end), side by side ── */
  .summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-top: 3.5mm;
    break-inside: avoid; page-break-inside: avoid; }
  .notes { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2.5mm; line-height: 1.5; }
  .tax-note { white-space: pre-line; padding: 2mm 3mm; background: var(--stripe);
    border-inline-start: 2pt solid var(--accent); font-size: 8.5pt; }
  .pay { font-size: 9pt; }
  .totals { flex: 0 0 76mm; }
  .t-row { display: flex; justify-content: space-between; gap: 4mm; padding: 0.9mm 2.2mm; font-size: 9pt; }
  .t-row.neg .t-v { color: #a40000; }
  .t-v { white-space: nowrap; text-align: end; }
  .t-grand { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; margin-top: 1mm;
    padding: 2mm 2.2mm; border-top: 1.5pt solid var(--ink); border-bottom: 1.5pt solid var(--ink); color: var(--ink); }
  .t-grand span:first-child { font-weight: 700; font-size: 10pt; }
  .t-grand .t-v { font-weight: 800; font-size: 14pt; }
  .t-due { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; padding: 1.6mm 2.2mm;
    border-bottom: 1.5pt solid var(--ink); color: var(--ink); font-weight: 700; }
  .t-due .t-v { font-weight: 800; font-size: 12pt; }
  .t-words { padding: 1.6mm 2.2mm 0; font-size: 8pt; line-height: 1.5; color: var(--text); }
  .t-words-k { color: var(--muted); }

  /* ── Installment plan ── */
  .plan { margin-top: 0.5mm; }
  .sec-title { font-weight: 700; font-size: 9pt; color: var(--ink); margin-bottom: 1mm; }
  .plan-table th { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700;
    padding: 1mm 2.2mm; border-bottom: 0.75pt solid var(--ink); text-align: start; }
  .plan-table td { padding: 1mm 2.2mm; border-bottom: 0.5pt solid var(--line); font-size: 8.5pt; }
  .plan-table .paid { width: 18mm; text-align: center; }

  .regards { margin-top: 1.5mm; }
  .regards .who { font-weight: 700; color: var(--ink); }

  /* ── Footer: pinned to the bottom of the (last) page, 3 equal columns ── */
  .spacer { flex: 1 1 auto; min-height: 5mm; }
  .footer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6mm;
    padding-top: 3mm; border-top: 0.75pt solid var(--ink); font-size: 7.5pt; line-height: 1.4;
    break-inside: avoid; page-break-inside: avoid; }
  .f-head { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 1mm; }
  .f-addr { font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
  .f-line { margin-bottom: 0.8mm; }
  .f-row { display: flex; gap: 2mm; }
  .f-k { flex: 0 0 auto; min-width: 11mm; color: var(--muted); }
  .f-v { flex: 1 1 auto; min-width: 0; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .f-v bdi { white-space: nowrap; }
</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <div class="bar"></div>

    <header class="head">
      <div>
        <div class="brand">${esc(brand)}</div>
        ${s.job_title ? `<div class="brand-sub">${esc(s.job_title)}</div>` : ''}
      </div>
      <div class="doc">
        <h1>${esc(docTitle)}</h1>
        <div class="doc-no"><bdi>${esc(d.invoiceNumber)}</bdi></div>
      </div>
    </header>

    <section class="parties">
      <div class="to">
        <div class="sender-sm">${esc(sellerName)} · ${esc(s.street)} · ${esc(s.postal_code)} ${esc(s.city)}</div>
        <div class="recipient">
          <div class="name">${esc(custName)}</div>
          ${c.contact_person ? `<div>${rtl ? 'جناب/سرکار ' : lang === 'en' ? 'Attn. ' : 'z. Hd. '}${esc(c.contact_person)}</div>` : ''}
          ${c.street ? `<div>${esc(c.street)}</div>` : ''}
          ${c.postal_code || c.city ? `<div>${esc(c.postal_code ? num(String(c.postal_code)) : '')} ${esc(c.city)}</div>` : ''}
          ${c.country && c.country !== 'DE' ? `<div>${esc(c.country)}</div>` : ''}
          ${c.ust_idnr ? `<div>${t.vatId}: <bdi dir="ltr">${esc(c.ust_idnr)}</bdi></div>` : ''}
          ${c.national_id ? `<div>${t.nationalId}: ${esc(num(String(c.national_id)))}</div>` : ''}
          ${c.economic_code ? `<div>${t.economicCode}: ${esc(num(String(c.economic_code)))}</div>` : ''}
          ${c.email ? `<div><bdi dir="ltr">${esc(c.email)}</bdi></div>` : ''}
        </div>
      </div>
      <dl class="meta">
        ${metaRow(t.metaDate, fdate(d.invoiceDate))}
        ${metaRow(t.metaDelivery, serviceValue)}
        ${metaRow(t.metaCustomer, d.customerCode)}
        ${metaRow(t.metaContact, (s.full_name as string) ?? '')}
        ${d.projectName ? metaRow(rtl ? 'پروژه' : lang === 'en' ? 'Project' : 'Projekt', d.projectName) : ''}
        ${d.projectNumber ? metaRow(rtl ? 'کد پروژه' : lang === 'en' ? 'Project no' : 'Projektnr', d.projectNumber) : ''}
        ${d.contractReference ? metaRow(rtl ? 'قرارداد' : lang === 'en' ? 'Contract' : 'Vertrag', d.contractReference) : ''}
        ${d.orderReference ? metaRow(rtl ? 'شماره سفارش' : lang === 'en' ? 'Order no' : 'Bestellnr', d.orderReference) : ''}
        ${d.buyerReference ? metaRow(rtl ? 'مرجع خریدار' : lang === 'en' ? 'Buyer ref' : 'Leitweg-ID', d.buyerReference) : ''}
      </dl>
    </section>

    <div class="intro">
      <div class="g">${esc(t.greeting)}</div>
      <div>${esc(t.intro)}</div>
    </div>

    <table class="items">
      <thead><tr>
        <th class="pos">#</th>
        <th>${esc(t.colService)}</th>
        <th class="num">${esc(t.colScope)}</th>
        <th class="num">${esc(t.colPrice)}</th>
        <th class="num">${esc(t.colTotal)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="summary">
      <div class="notes">${notes}</div>
      <div class="totals">${totalsRows.join('')}${wordsBlock}</div>
    </div>

    <div class="spacer"></div>
    <footer class="footer">
      ${footCol(t.contactHead, contactCol)}
      ${footCol(t.bankHead, bankCol)}
      ${footCol(t.taxHead, taxCol)}
    </footer>
  </div>
</body></html>`;
}
