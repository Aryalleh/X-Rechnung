/**
 * Contract PDF (A4): accent bar, brand + title + number, parties, contract
 * body, both signatures, and a final "signature certificate" page with the
 * audit trail (hash, timestamps, IP, user agent) — the evidence for a simple
 * electronic signature (eIDAS Art. 25(1) / einfache elektronische Signatur).
 */
import { parseBlocks, renderBlocksHtml, escHtml as esc } from '../../lib/contract-doc';
import { formatDateFor, toPersianDigits } from '../../lib/format';
import { persianFontFaceCss } from './fonts';

type Lang = 'de' | 'en' | 'fa';

export interface ContractPdfData {
  language: Lang;
  title: string;
  contractNumber: string;
  resolvedBody: string;
  fieldValues: Record<string, string | boolean>;
  seller: Record<string, unknown>;
  customer: Record<string, unknown>;
  sellerSignerName: string | null;
  sellerSignature: string | null;
  sellerSignedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signature: string | null;
  signedAt: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  contentHash: string | null;
  contractId: string;
  accentColor?: string;
  brandHeading?: string;
  customFont?: { family?: string; regularDataUrl?: string; boldDataUrl?: string };
  draft?: boolean;
}

const L = {
  de: { provider: 'Auftragnehmer', client: 'Auftraggeber', no: 'Vertragsnr.', signedOn: 'Unterzeichnet am', sign: 'Unterschrift', notSigned: 'Noch nicht unterschrieben', cert: 'Signaturnachweis', certSub: 'Einfache elektronische Signatur (eIDAS Art. 3 Nr. 10). Dieses Protokoll dokumentiert den Signaturvorgang.', doc: 'Dokument', hash: 'Dokument-Hash (SHA-256)', sent: 'Versendet', viewed: 'Geöffnet', signed: 'Unterschrieben', signer: 'Unterzeichner', email: 'E-Mail', ip: 'IP-Adresse', ua: 'Browser', id: 'Vorgangs-ID', draft: 'ENTWURF', page: 'Seite' },
  en: { provider: 'Contractor', client: 'Client', no: 'Contract no', signedOn: 'Signed on', sign: 'Signature', notSigned: 'Not signed yet', cert: 'Signature certificate', certSub: 'Simple electronic signature (eIDAS Art. 3(10)). This log documents the signing process.', doc: 'Document', hash: 'Document hash (SHA-256)', sent: 'Sent', viewed: 'Opened', signed: 'Signed', signer: 'Signer', email: 'E-mail', ip: 'IP address', ua: 'Browser', id: 'Transaction ID', draft: 'DRAFT', page: 'Page' },
  fa: { provider: 'مجری', client: 'کارفرما', no: 'شماره قرارداد', signedOn: 'تاریخ امضا', sign: 'امضا', notSigned: 'هنوز امضا نشده', cert: 'گواهی امضا', certSub: 'امضای الکترونیکی ساده. این گزارش روند امضای قرارداد را ثبت می‌کند.', doc: 'سند', hash: 'اثر انگشت سند (SHA-256)', sent: 'ارسال', viewed: 'مشاهده', signed: 'امضا', signer: 'امضاکننده', email: 'ایمیل', ip: 'نشانی IP', ua: 'مرورگر', id: 'شناسهٔ تراکنش', draft: 'پیش‌نویس', page: 'صفحه' },
} as const;

/** ISO timestamp → localized date + UTC time, e.g. "06.11.2026, 14:03 UTC". */
function stamp(iso: string | null, lang: Lang): string {
  if (!iso) return '—';
  const time = iso.slice(11, 16);
  const s = `${formatDateFor(iso, lang)}, ${lang === 'fa' ? toPersianDigits(time) : time} UTC`;
  return s;
}

export function renderContractHtml(d: ContractPdfData): string {
  const lang = d.language;
  const t = L[lang];
  const rtl = lang === 'fa';
  const s = d.seller;
  const c = d.customer;
  const accent = d.accentColor || '#F2EA00';
  const brand = d.brandHeading || (s.business_name as string) || (s.full_name as string) || '';
  const custName = (c.company_name as string) || (c.name as string) || '';
  const addr = (o: Record<string, unknown>) => [o.street, [o.postal_code, o.city].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');

  const body = renderBlocksHtml(parseBlocks(d.resolvedBody), { values: d.fieldValues, formatDate: (iso) => formatDateFor(iso, lang) });

  const sigBox = (role: string, name: string | null, img: string | null, at: string | null) => `
    <div class="sig">
      <div class="sig-role">${esc(role)}</div>
      <div class="sig-img">${img && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img) ? `<img src="${img}" alt="">` : `<span class="sig-none">${esc(t.notSigned)}</span>`}</div>
      <div class="sig-line"></div>
      <div class="sig-name">${esc(name || '')}</div>
      <div class="sig-at">${at ? `${esc(t.signedOn)} ${esc(stamp(at, lang))}` : ''}</div>
    </div>`;

  const row = (k: string, v: string | null, ltr = false) => `<tr><th>${esc(k)}</th><td>${ltr ? `<bdi dir="ltr">${esc(v ?? '—')}</bdi>` : esc(v ?? '—')}</td></tr>`;

  const fontFaces = rtl ? persianFontFaceCss(d.customFont) : '';
  const bodyFont = rtl
    ? `'${d.customFont?.family || 'Vazirmatn'}', 'Noto Sans Arabic', Tahoma, Arial, sans-serif`
    : `'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif`;

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(d.title)} ${esc(d.contractNumber)}</title>
<style>
  @page { size: A4; margin: 16mm 0 14mm; }
  @page :first { margin-top: 0; }
  ${fontFaces}
  * { box-sizing: border-box; }
  :root { --accent: ${accent}; --ink: #16181d; --text: #2b2e35; --muted: #6a6f7a; --line: #dfe1e6; --soft: #f6f6f3; }
  html, body { margin: 0; width: 210mm; }
  body { font-family: ${bodyFont}; font-size: 10pt; line-height: 1.55; color: var(--text);
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { padding: 0 18mm; }
  .bar { height: 2.5mm; background: var(--accent); margin: 0 -18mm 9mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; padding-bottom: 3mm; border-bottom: 0.75pt solid var(--ink); }
  .brand { font-weight: 800; font-size: 15pt; color: var(--ink); }
  .meta { text-align: end; font-size: 8.5pt; color: var(--muted); }
  .meta b { color: var(--ink); font-size: 10pt; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin: 6mm 0 2mm; }
  .party { padding: 3mm 4mm; background: var(--soft); border-inline-start: 2pt solid var(--accent); font-size: 9pt; line-height: 1.45; }
  .party .k { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .party .n { font-weight: 700; color: var(--ink); font-size: 10pt; }
  .c-h1 { font-size: 17pt; line-height: 1.2; margin: 7mm 0 3mm; color: var(--ink); font-weight: 800; }
  .c-h2 { font-size: 11pt; margin: 5mm 0 1.5mm; color: var(--ink); font-weight: 700; break-after: avoid; page-break-after: avoid; }
  .c-p { margin: 0 0 2.5mm; orphans: 3; widows: 3; }
  .c-li { display: flex; gap: 2.5mm; margin: 0 0 1.5mm; }
  .c-mark { color: var(--muted); min-width: 5mm; }
  .c-filled { font-weight: 700; color: var(--ink); border-bottom: 0.75pt solid var(--ink); padding: 0 1mm; }
  .c-blank { display: inline-block; min-width: 38mm; border-bottom: 0.75pt dashed var(--muted); color: var(--muted); font-size: 7.5pt; padding: 0 1mm; }
  .c-check { font-size: 12pt; color: var(--ink); }
  .c-var { background: #fff3a6; color: #7a5b00; padding: 0 1mm; border-radius: 1mm; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 10mm; break-inside: avoid; page-break-inside: avoid; }
  .sig-role { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .sig-img { height: 22mm; display: flex; align-items: flex-end; }
  .sig-img img { max-height: 22mm; max-width: 70mm; }
  .sig-none { color: var(--muted); font-size: 8.5pt; font-style: italic; }
  .sig-line { border-top: 0.75pt solid var(--ink); margin-top: 1mm; }
  .sig-name { font-weight: 700; color: var(--ink); margin-top: 1mm; }
  .sig-at { font-size: 8pt; color: var(--muted); }
  .cert { break-before: page; page-break-before: always; padding-top: 2mm; }
  .cert h2 { font-size: 14pt; color: var(--ink); margin: 0 0 1mm; }
  .cert p { font-size: 8.5pt; color: var(--muted); margin: 0 0 5mm; }
  .cert table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .cert th { text-align: start; font-weight: 600; color: var(--muted); width: 45mm; padding: 1.8mm 2mm; border-bottom: 0.5pt solid var(--line); vertical-align: top; }
  .cert td { padding: 1.8mm 2mm; border-bottom: 0.5pt solid var(--line); color: var(--ink); overflow-wrap: anywhere; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 84pt; font-weight: 800; color: rgba(190,0,0,0.08); transform: rotate(-18deg); }
</style></head>
<body>
  ${d.draft ? `<div class="watermark">${esc(t.draft)}</div>` : ''}
  <div class="wrap">
    <div class="bar"></div>
    <header class="head">
      <div class="brand">${esc(brand)}</div>
      <div class="meta">${esc(t.no)}<br><b><bdi>${esc(d.contractNumber)}</bdi></b></div>
    </header>
    <section class="parties">
      <div class="party"><div class="k">${esc(t.provider)}</div><div class="n">${esc([s.full_name, s.business_name].filter(Boolean).join(' · '))}</div>${addr(s)}</div>
      <div class="party"><div class="k">${esc(t.client)}</div><div class="n">${esc(custName)}</div>${addr(c)}</div>
    </section>
    <main>${body}</main>
    <section class="sigs">
      ${sigBox(t.provider, d.sellerSignerName || (s.full_name as string), d.sellerSignature, d.sellerSignedAt)}
      ${sigBox(t.client, d.signerName || custName, d.signature, d.signedAt)}
    </section>
    ${d.signedAt ? `<section class="cert">
      <h2>${esc(t.cert)}</h2>
      <p>${esc(t.certSub)}</p>
      <table>
        ${row(t.doc, `${d.title} · ${d.contractNumber}`)}
        ${row(t.id, d.contractId, true)}
        ${row(t.hash, d.contentHash, true)}
        ${row(`${t.sent}`, stamp(d.sentAt, lang))}
        ${row(`${t.viewed}`, stamp(d.viewedAt, lang))}
        ${row(`${t.signed} (${t.client})`, `${d.signerName ?? ''} — ${stamp(d.signedAt, lang)}`)}
        ${row(t.email, d.signerEmail, true)}
        ${row(t.ip, d.signerIp, true)}
        ${row(t.ua, d.signerUserAgent, true)}
        ${d.sellerSignedAt ? row(`${t.signed} (${t.provider})`, `${d.sellerSignerName ?? ''} — ${stamp(d.sellerSignedAt, lang)}`) : ''}
      </table>
    </section>` : ''}
  </div>
</body></html>`;
}
