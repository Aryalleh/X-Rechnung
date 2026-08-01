/** German (de-DE) formatting for amounts and dates. No external deps. */

/** 125000 cents -> "1.250,00 €" */
export function formatEuro(cents: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  const eurosStr = groupThousands(euros.toString());
  const restStr = rest.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${eurosStr},${restStr} ${symbol}`.trim();
}

/** 125000 -> "1.250,00" (no symbol) */
export function formatAmount(cents: number): string {
  return formatEuro(cents, '').trim();
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** ISO date/datetime "2026-08-01..." -> "01.08.2026" */
export function formatDateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const datePart = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Today's date in Europe/Berlin as YYYY-MM-DD. */
export function berlinToday(now: Date = new Date()): string {
  // en-CA yields ISO-like YYYY-MM-DD; timeZone shifts to Berlin wall clock.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Add N days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Year (number) of a YYYY-MM-DD date. */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}
