/**
 * Smart, language-aware fuzzy search used for customers.
 *
 * - Normalizes German diacritics (ü→u, ß→ss), Persian/Arabic letter variants
 *   (ي→ی, ك→ک, ة→ه, removes tatweel/harakat, ZWNJ) and Persian/Arabic digits.
 * - Multi-token AND: every query word must match some field.
 * - Ranks exact code > code prefix > word prefix > substring > typo match.
 * - Typo tolerance: one edit (Damerau-Levenshtein) for words of 4+ letters.
 * - Numeric queries match customer codes loosely ("12" finds "KD-0012").
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  s = s
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ً-ٰٟـ]/g, '') // harakat + tatweel
    .replace(/‌/g, ' '); // ZWNJ → space
  s = s.replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Restricted Damerau-Levenshtein distance, early-exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let k = 0; k <= b.length; k++) prev2[k] = prev[k]!;
    prev = cur;
  }
  return prev[b.length]!;
}

export interface SearchableCustomer {
  customer_code: string;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  postal_code?: string | null;
  street?: string | null;
  ust_idnr?: string | null;
  is_active?: number;
}

const NAME_FIELDS = ['company_name', 'first_name', 'last_name', 'contact_person'] as const;
const OTHER_FIELDS = ['email', 'city', 'postal_code', 'street', 'ust_idnr'] as const;

/** Score one token against one customer. Lower is better; null = no match. */
function scoreToken(token: string, c: SearchableCustomer, codeNorm: string, words: string[], blob: string): number | null {
  const codeDigits = codeNorm.replace(/\D/g, '');
  const codeCompact = codeNorm.replace(/[^a-z0-9]/g, '');
  const tokCompact = token.replace(/[^a-z0-9؀-ۿ]/g, '');

  if (token === codeNorm || (tokCompact && tokCompact === codeCompact)) return 0;
  // "kd12" / "kd-12" ≙ "KD-0012": same letter prefix + same number.
  const tm = /^([a-z]+)-?(\d+)$/.exec(token);
  const cm = /^([a-z]+)-?(\d+)$/.exec(codeNorm);
  if (tm && cm && tm[1] === cm[1] && Number(tm[2]) === Number(cm[2])) return 0;
  if (/^\d+$/.test(token)) {
    if (codeDigits && Number(token) === Number(codeDigits)) return 0;
    if (codeDigits.endsWith(token)) return 1;
    const phone = (c.phone ?? '').replace(/\D/g, '');
    if (phone && phone.includes(token)) return 3;
    if ((c.postal_code ?? '').startsWith(token)) return 3;
  }
  if (codeNorm.startsWith(token) || (tokCompact && codeCompact.startsWith(tokCompact))) return 1;
  if (words.some((w) => w.startsWith(token))) return 2;
  if (blob.includes(token)) return 3;
  if (token.length >= 4) {
    const max = token.length >= 8 ? 2 : 1;
    for (const w of words) {
      const cand = w.length > token.length ? w.slice(0, token.length) : w;
      if (editDistance(token, cand, max) <= max) return 4;
    }
  }
  return null;
}

export function scoreCustomer(query: string, c: SearchableCustomer): number | null {
  const q = normalizeText(query);
  if (!q) return 0;
  const tokens = q.split(' ').filter(Boolean);
  const codeNorm = normalizeText(c.customer_code);
  const nameText = NAME_FIELDS.map((f) => normalizeText(c[f])).filter(Boolean).join(' ');
  const otherText = OTHER_FIELDS.map((f) => normalizeText(c[f])).filter(Boolean).join(' ');
  const blob = `${codeNorm} ${nameText} ${otherText}`;
  const words = blob.split(/[\s@.,\-_/()]+/).filter(Boolean);

  let total = 0;
  for (const t of tokens) {
    const s = scoreToken(t, c, codeNorm, words, blob);
    if (s === null) return null;
    total += s;
  }
  // Whole query as a phrase in the name ranks higher.
  if (tokens.length > 1 && nameText.includes(q)) total -= 1;
  if (c.is_active === 0) total += 2;
  return total;
}

export function rankCustomers<T extends SearchableCustomer>(query: string, rows: T[], limit = 20): T[] {
  const scored: { row: T; score: number; name: string }[] = [];
  for (const row of rows) {
    const score = scoreCustomer(query, row);
    if (score !== null) {
      scored.push({ row, score, name: normalizeText(row.company_name || row.last_name || row.customer_code) });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.row);
}
