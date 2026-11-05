/**
 * Money & quantity math — integer cents only, never floats.
 *
 * Amounts are integer cents (EUR: 1 € = 100 cents). Quantities are decimal
 * STRINGS (e.g. "6", "1.5", "2,5") parsed exactly via BigInt so that
 * quantity × unit price is computed without floating point error. Rounding is
 * kaufmännisches Runden (round half away from zero) at the cent boundary.
 */

export interface ParsedQuantity {
  /** Integer mantissa, e.g. "1.5" -> 15n */
  mantissa: bigint;
  /** Number of fractional digits, e.g. "1.5" -> 1 */
  scale: number;
  /** true when negative */
  negative: boolean;
}

/** Parse a decimal quantity string (accepts '.' or ',' as separator). */
export function parseQuantity(input: string): ParsedQuantity {
  const raw = input.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid quantity: ${input}`);
  }
  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ''] = abs.split('.');
  const scale = fracPart.length;
  const mantissa = BigInt((intPart ?? '0') + fracPart || '0');
  return { mantissa, scale, negative };
}

/** Round a BigInt ratio (value / 10^scale) to an integer, half away from zero. */
function roundScaled(value: bigint, scale: number): bigint {
  if (scale === 0) return value;
  const divisor = 10n ** BigInt(scale);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Compute a line total in cents:
 *   round(quantity × unitPriceCents) − discountCents
 * Discount is an absolute cent amount applied after multiplication.
 */
export function lineTotalCents(
  quantity: string,
  unitPriceCents: number,
  discountCents = 0,
): number {
  assertInteger(unitPriceCents, 'unitPriceCents');
  assertInteger(discountCents, 'discountCents');
  const q = parseQuantity(quantity);
  const product = BigInt(unitPriceCents) * q.mantissa;
  let cents = roundScaled(product, q.scale);
  if (q.negative) cents = -cents;
  cents -= BigInt(discountCents);
  return Number(cents);
}

export interface LineInput {
  quantity: string;
  unitPriceCents: number;
  discountCents?: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  lineTotals: number[];
}

/**
 * Recompute all line totals and document totals from raw inputs.
 * This is the authoritative calculation — the backend never trusts totals
 * supplied by the frontend.
 */
export function computeTotals(lines: LineInput[]): Totals {
  const lineTotals: number[] = [];
  let subtotal = 0;
  let discountSum = 0;
  for (const line of lines) {
    const discount = line.discountCents ?? 0;
    const total = lineTotalCents(line.quantity, line.unitPriceCents, discount);
    lineTotals.push(total);
    subtotal += total;
    discountSum += discount;
  }
  return {
    subtotalCents: subtotal,
    discountCents: discountSum,
    totalCents: subtotal,
    lineTotals,
  };
}

function assertInteger(n: number, name: string): void {
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer cent value, got ${n}`);
  }
}

/** Multiply an integer by basis points (1 bp = 0.01%), half away from zero. */
function applyBasisPoints(amount: number, bp: number): number {
  if (bp === 0) return 0;
  const num = BigInt(amount) * BigInt(bp);
  const den = 10000n;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return Number(neg ? -rounded : rounded);
}

export type DiscountMode = 'NONE' | 'PERCENT' | 'FIXED';

export interface DocumentTotalsInput {
  lines: LineInput[];
  discountMode?: DiscountMode;
  /** PERCENT: basis points (1000 = 10%). FIXED: minor units. */
  discountValue?: number;
  /** VAT rate in basis points (1900 = 19%). 0 = tax-free / Kleinunternehmer. */
  taxRateBp?: number;
  /** Prepaid amount (Anzahlung) already received before issuing. */
  advancePaidCents?: number;
}

export interface DocumentTotals {
  lineTotals: number[];
  /** Sum of line totals (each already net of its own line discount). */
  lineSubtotalCents: number;
  /** Document-level discount applied after the line sum. */
  discountCents: number;
  /** lineSubtotal − documentDiscount. */
  netCents: number;
  /** VAT amount on the net. */
  taxCents: number;
  /** net + tax (gross). */
  totalCents: number;
  advancePaidCents: number;
  /** total − advance (what is still payable). */
  amountDueCents: number;
}

/**
 * Full document calculation: line totals → document discount → net → VAT →
 * gross total → minus advance = amount due. All integer minor units.
 */
export function computeDocumentTotals(input: DocumentTotalsInput): DocumentTotals {
  const base = computeTotals(input.lines);
  const lineSubtotal = base.subtotalCents;

  const mode = input.discountMode ?? 'NONE';
  let discount = 0;
  if (mode === 'PERCENT') discount = applyBasisPoints(lineSubtotal, input.discountValue ?? 0);
  else if (mode === 'FIXED') discount = Math.min(Math.max(0, Math.trunc(input.discountValue ?? 0)), lineSubtotal);

  const net = lineSubtotal - discount;
  const taxRateBp = Math.max(0, Math.trunc(input.taxRateBp ?? 0));
  const tax = applyBasisPoints(net, taxRateBp);
  const total = net + tax;
  const advance = Math.max(0, Math.trunc(input.advancePaidCents ?? 0));
  const amountDue = total - advance;

  return {
    lineTotals: base.lineTotals,
    lineSubtotalCents: lineSubtotal,
    discountCents: discount,
    netCents: net,
    taxCents: tax,
    totalCents: total,
    advancePaidCents: advance,
    amountDueCents: amountDue,
  };
}

/** Parse a EUR amount string like "1.250,00" or "1250.00" into integer cents. */
export function euroStringToCents(input: string): number {
  const raw = input.trim().replace(/\s|€/g, '');
  // German: "1.250,00" -> remove thousand dots, comma is decimal.
  let normalized: string;
  if (raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = raw;
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid amount: ${input}`);
  }
  const negative = normalized.startsWith('-');
  const abs = negative ? normalized.slice(1) : normalized;
  const [intPart, fracPart = ''] = abs.split('.');
  const frac = (fracPart + '00').slice(0, 2);
  const cents = BigInt(intPart ?? '0') * 100n + BigInt(frac || '0');
  return Number(negative ? -cents : cents);
}
