/**
 * Contract document model — shared by the Worker (PDF) and the SPA (preview,
 * signing page). Pure TS, no DOM.
 *
 * Syntax (one block per line):
 *   "# Title" / "## Section"        headings
 *   "- item" / "1. item"            list items
 *   blank line                      paragraph break (consecutive lines join with a line break)
 *   {{variable}}                    replaced when the contract is generated
 *   [[Label]] [[Label:date]]        filled by the customer while signing
 *   [[Label:number]] [[Label:checkbox]]
 */

import { formatDateFor, berlinToday } from './format';

export type FieldType = 'text' | 'date' | 'number' | 'checkbox';
export interface FieldDef { key: string; label: string; type: FieldType; required: boolean }

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'var'; key: string }
  | { kind: 'field'; field: FieldDef };

export interface Block { type: 'h1' | 'h2' | 'p' | 'li'; marker?: string; lines: Part[][] }

const VAR_RE = /\{\{\s*([^{}\n]+?)\s*\}\}/g;
const FIELD_RE = /\[\[\s*([^[\]\n]+?)\s*\]\]/g;
const TYPES: FieldType[] = ['text', 'date', 'number', 'checkbox'];

/** Variables filled automatically from the seller / customer / contract. */
export const STANDARD_VARS = [
  'customer_name', 'customer_address', 'customer_email', 'customer_contact',
  'seller_name', 'seller_business', 'seller_address', 'seller_email', 'seller_phone',
  'contract_number', 'contract_title', 'today',
] as const;

/** Unique {{variables}} in order of first appearance. */
export function extractVariables(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(VAR_RE)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Custom variables = those the user must type in the generator. */
export function customVariables(body: string): string[] {
  return extractVariables(body).filter((v) => !(STANDARD_VARS as readonly string[]).includes(v));
}

/** Replace {{variables}}; unknown/empty ones are left as-is so they stay visible. */
export function substitute(body: string, vars: Record<string, string | undefined | null>): string {
  return body.replace(VAR_RE, (whole, k: string) => {
    const v = vars[k];
    return v != null && String(v).trim() !== '' ? String(v).replace(/\[\[|\]\]|\{\{|\}\}/g, '') : whole;
  });
}

export function missingVariables(body: string, vars: Record<string, string | undefined | null>): string[] {
  return extractVariables(body).filter((k) => vars[k] == null || String(vars[k]).trim() === '');
}

function parseField(raw: string, index: number): FieldDef {
  const i = raw.lastIndexOf(':');
  const maybe = i > 0 ? raw.slice(i + 1).trim().toLowerCase() : '';
  const type: FieldType = (TYPES as string[]).includes(maybe) ? (maybe as FieldType) : 'text';
  const label = type !== 'text' || maybe === 'text' ? raw.slice(0, i).trim() : raw.trim();
  return { key: `f${index}`, label: label || `#${index}`, type, required: type !== 'checkbox' };
}

/** Customer-fillable [[fields]] (keys f1…fn by order of appearance). */
export function parseFields(body: string): FieldDef[] {
  let n = 0;
  return [...body.matchAll(FIELD_RE)].map((m) => parseField(m[1]!, ++n));
}

function parseInline(line: string, counter: { n: number }): Part[] {
  const parts: Part[] = [];
  const re = new RegExp(`${VAR_RE.source}|${FIELD_RE.source}`, 'g');
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1] != null) parts.push({ kind: 'var', key: m[1] });
    else parts.push({ kind: 'field', field: parseField(m[2]!, ++counter.n) });
    last = m.index! + m[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

/** Text → blocks. Field numbering matches parseFields(). */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const counter = { n: 0 };
  let para: Block | null = null;
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { para = null; continue; }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*•])|(\d+[.)]))\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: h[1] === '#' ? 'h1' : 'h2', lines: [parseInline(h[2]!, counter)] }); para = null; }
    else if (li) { blocks.push({ type: 'li', marker: li[2] ?? '•', lines: [parseInline(li[3]!, counter)] }); para = null; }
    else if (para) para.lines.push(parseInline(line.trim(), counter));
    else { para = { type: 'p', lines: [parseInline(line.trim(), counter)] }; blocks.push(para); }
  }
  return blocks;
}

export function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Blocks → static HTML (PDF / read-only preview). Field values are shown when
 * given; otherwise an empty fill-in box with the label. Variables still
 * unresolved are highlighted so they can't slip through unnoticed.
 */
export function renderBlocksHtml(blocks: Block[], opts: { values?: Record<string, string | boolean>; formatDate?: (iso: string) => string; checkboxYes?: string } = {}): string {
  const part = (p: Part): string => {
    if (p.kind === 'text') return escHtml(p.text);
    if (p.kind === 'var') return `<mark class="c-var">{{${escHtml(p.key)}}}</mark>`;
    const v = opts.values?.[p.field.key];
    if (p.field.type === 'checkbox') {
      return `<span class="c-check">${v ? '☑' : '☐'}</span> ${escHtml(p.field.label)}`;
    }
    if (v == null || v === '') return `<span class="c-blank" title="${escHtml(p.field.label)}">${escHtml(p.field.label)}</span>`;
    const shown = p.field.type === 'date' && opts.formatDate ? opts.formatDate(String(v)) : String(v);
    return `<span class="c-filled">${escHtml(shown)}</span>`;
  };
  return blocks.map((b) => {
    const inner = b.lines.map((l) => l.map(part).join('')).join('<br>');
    if (b.type === 'h1') return `<h1 class="c-h1">${inner}</h1>`;
    if (b.type === 'h2') return `<h2 class="c-h2">${inner}</h2>`;
    if (b.type === 'li') return `<div class="c-li"><span class="c-mark">${escHtml(b.marker)}</span><div>${inner}</div></div>`;
    return `<p class="c-p">${inner}</p>`;
  }).join('\n');
}

/** Validate customer values against field definitions → list of missing labels. */
export function missingFields(fields: FieldDef[], values: Record<string, unknown>): string[] {
  return fields.filter((f) => f.required && (values[f.key] == null || String(values[f.key]).trim() === '')).map((f) => f.label);
}

/** Standard {{variables}} from the parties. */
export function standardVariables(o: {
  seller: Record<string, unknown>; customer: Record<string, unknown>; lang: 'de' | 'en' | 'fa'; number: string; title: string; today?: string;
}): Record<string, string> {
  const s = o.seller; const c = o.customer;
  const str = (v: unknown) => (v == null ? '' : String(v));
  const address = (x: Record<string, unknown>) =>
    [str(x.street), [str(x.postal_code), str(x.city)].filter(Boolean).join(' '), x.country && x.country !== 'DE' && x.country !== 'IR' ? str(x.country) : '']
      .filter(Boolean).join(', ');
  return {
    customer_name: str(c.company_name) || str(c.name),
    customer_address: address(c),
    customer_email: str(c.email),
    customer_contact: str(c.contact_person),
    seller_name: [str(s.full_name), str(s.business_name)].filter(Boolean).join(' · '),
    seller_business: str(s.business_name) || str(s.full_name),
    seller_address: address(s),
    seller_email: str(s.email),
    seller_phone: str(s.phone),
    contract_number: o.number,
    contract_title: o.title,
    today: formatDateFor(o.today ?? berlinToday(), o.lang),
  };
}

