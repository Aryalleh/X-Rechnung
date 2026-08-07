/**
 * Persian (fa-IR, RTL) invoice template — «فاکتور فروش».
 *
 * Uses the shared TemplateData shape. Amounts are formatted with formatMoney()
 * in the invoice's currency (ریال / تومان / … or the future redenominated unit
 * with «قران»). No German §19 wording here; a tax/description note is shown only
 * if provided. Self-contained print CSS (A4), no external fonts.
 */
import { formatMoney, toPersianDigits, formatDateDe } from '../../lib/format';
import type { TemplateData } from './template';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HEADINGS: Record<string, string> = {
  RECHNUNG: 'فاکتور فروش',
  STORNORECHNUNG: 'فاکتور برگشتی (ابطال)',
  GUTSCHRIFT: 'بستانکاری',
};

/** Persian date (YYYY-MM-DD Gregorian shown as DD.MM.YYYY with Persian digits). */
function faDate(iso: string | null | undefined): string {
  return toPersianDigits(formatDateDe(iso));
}

export function renderInvoiceHtmlFa(d: TemplateData): string {
  const s = d.seller;
  const c = d.customer;
  const cur = d.currency;
  const money = (n: number) => formatMoney(n, cur);
  const sellerName = [s.full_name, s.business_name].filter(Boolean).join(' — ');
  const custName = (c.company_name as string) || (c.name as string) || '';

  const serviceInfo = d.servicePeriodStart && d.servicePeriodEnd
    ? `دورهٔ خدمت: ${faDate(d.servicePeriodStart)} تا ${faDate(d.servicePeriodEnd)}`
    : d.serviceDate
      ? `تاریخ خدمت: ${faDate(d.serviceDate)}`
      : `تاریخ خدمت: ${faDate(d.invoiceDate)}`;

  const rows = d.items.map((it, idx) => {
    const rights = it.rightsText ? `<div class="rights">${esc(it.rightsText)}</div>` : '';
    const disc = it.discountCents ? `<div class="disc">تخفیف: ${money(it.discountCents)}</div>` : '';
    return `<tr>
      <td class="pos">${toPersianDigits(String(idx + 1))}</td>
      <td class="desc">${esc(it.description)}${rights}</td>
      <td class="num">${toPersianDigits(it.quantity)}</td>
      <td class="unit">${esc(it.unit)}</td>
      <td class="num">${money(it.unitPriceCents)}</td>
      <td class="num">${money(it.lineTotalCents)}${disc}</td>
    </tr>`;
  }).join('');

  const bank = d.showBank ? `
    <div class="bank">
      <div><strong>شماره شبا/حساب:</strong> <span dir="ltr">${esc(s.iban)}</span></div>
      ${s.bic ? `<div><strong>شناسه بانک:</strong> <span dir="ltr">${esc(s.bic)}</span></div>` : ''}
      <div><strong>صاحب حساب:</strong> ${esc(s.account_holder)}</div>
      ${s.bank_name ? `<div><strong>بانک:</strong> ${esc(s.bank_name)}</div>` : ''}
      <div><strong>بابت:</strong> ${esc(d.invoiceNumber)}</div>
    </div>` : '';

  const watermark = d.draft ? `<div class="watermark">پیش‌نویس</div>` : '';
  const taxNote = d.taxExemptionText ? `<div class="tax-note">${esc(d.taxExemptionText)}</div>` : '';

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 20mm 16mm 24mm 16mm; }
  * { box-sizing: border-box; }
  html, body { font-family: "Vazirmatn", "DejaVu Sans", Tahoma, Arial, sans-serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.6; margin: 0; direction: rtl; }
  .watermark { position: fixed; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 84pt; color: rgba(200,0,0,0.12); font-weight: bold; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; }
  .seller-head { font-size: 9pt; color: #444; }
  .seller-head .name { font-size: 12pt; color: #111; font-weight: bold; }
  h1 { text-align: center; font-size: 16pt; margin: 3mm 0; }
  .meta-grid { display: flex; justify-content: space-between; gap: 6mm; margin: 5mm 0; font-size: 9.5pt; }
  .box { border: 0.5pt solid #999; border-radius: 4px; padding: 3mm; flex: 1; }
  .box .t { font-weight: bold; margin-bottom: 1mm; color: #555; }
  table.items { width: 100%; border-collapse: collapse; margin: 4mm 0; }
  table.items th { border: 0.5pt solid #333; background: #f2f2f2; padding: 1.6mm; font-size: 9pt; text-align: center; }
  table.items td { border: 0.4pt solid #ccc; padding: 1.6mm; vertical-align: top; }
  table.items tr { page-break-inside: avoid; }
  td.num, td.pos, td.unit { text-align: center; white-space: nowrap; }
  td.desc { text-align: right; }
  .rights { font-size: 8pt; color: #555; margin-top: 0.8mm; }
  .disc { font-size: 8pt; color: #a00; }
  .total-line { display: flex; justify-content: space-between; padding: 2mm 3mm; border-top: 1.5pt solid #333; font-weight: bold; font-size: 13pt; margin-top: 2mm; }
  .tax-note { margin: 4mm 0; padding: 2.5mm 3mm; background: #f5f5f5; border-right: 2pt solid #888; font-size: 9.5pt; }
  .pay { margin-top: 5mm; font-size: 9.5pt; }
  .bank { margin-top: 2mm; font-size: 9pt; }
  .thanks { margin-top: 5mm; font-size: 9.5pt; }
  footer { position: fixed; bottom: 0; right: 0; left: 0; font-size: 7.5pt; color: #666; border-top: 0.3pt solid #ccc; padding-top: 1.5mm; display: flex; justify-content: space-between; }
</style></head>
<body>
  ${watermark}
  <header>
    <div class="seller-head">
      <div class="name">${esc(sellerName)}</div>
      <div>${esc(s.street)}</div>
      <div>${esc(s.postal_code)} ${esc(s.city)}</div>
      ${s.phone ? `<div>تلفن: <span dir="ltr">${esc(s.phone)}</span></div>` : ''}
      <div dir="ltr">${esc(s.email)}</div>
      ${s.steuernummer ? `<div>کد اقتصادی/مالیاتی: ${esc(s.steuernummer)}</div>` : ''}
    </div>
    <div class="seller-head" style="text-align:left">
      <div><strong>شماره فاکتور:</strong> ${esc(d.invoiceNumber)}</div>
      <div><strong>تاریخ:</strong> ${faDate(d.invoiceDate)}</div>
      <div><strong>کد مشتری:</strong> ${esc(d.customerCode)}</div>
    </div>
  </header>

  <h1>${HEADINGS[d.documentType] ?? 'فاکتور فروش'}</h1>

  <div class="meta-grid">
    <div class="box">
      <div class="t">خریدار</div>
      <div><strong>${esc(custName)}</strong></div>
      ${c.contact_person ? `<div>جناب/سرکار ${esc(c.contact_person)}</div>` : ''}
      ${c.street ? `<div>${esc(c.street)}</div>` : ''}
      <div>${esc(c.postal_code)} ${esc(c.city)}</div>
      ${c.ust_idnr ? `<div>شناسه مالیاتی: ${esc(c.ust_idnr)}</div>` : ''}
    </div>
    <div class="box">
      <div class="t">مشخصات خدمت</div>
      <div>${serviceInfo}</div>
      ${d.projectName ? `<div>پروژه: ${esc(d.projectName)}</div>` : ''}
      ${d.orderReference ? `<div>شماره سفارش: ${esc(d.orderReference)}</div>` : ''}
      <div>سررسید پرداخت: ${faDate(d.dueDate)}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th>ردیف</th><th>شرح خدمات</th><th>تعداد</th><th>واحد</th><th>قیمت واحد</th><th>مبلغ</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="total-line"><span>مبلغ کل فاکتور</span><span>${money(d.totalCents)}</span></div>

  ${taxNote}

  <div class="pay">
    <div><strong>مهلت پرداخت:</strong> ${faDate(d.dueDate)}</div>
    ${d.paymentTermsText ? `<div>${esc(d.paymentTermsText)}</div>` : ''}
    ${bank}
  </div>

  ${d.thanksText ? `<div class="thanks">${esc(d.thanksText)}</div>` : ''}

  <footer>
    <span>${esc(sellerName)}</span>
    <span>${esc(d.invoiceNumber)}</span>
  </footer>
</body></html>`;
}
