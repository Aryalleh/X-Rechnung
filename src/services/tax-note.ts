/**
 * The tax note printed on an invoice, for every currency × language:
 *
 *   IRR/IRT (any language) → Iranian VAT status (micro business / type 1–2), localized.
 *   EUR, no VAT (rate 0)   → § 19 UStG Kleinunternehmer note, localized; the
 *                            Persian version keeps the German legal sentence too.
 *   EUR with VAT (rate > 0)→ no § 19 note (it would contradict the VAT line).
 *
 * The invoice's public note, if any, is appended in every case.
 */
import { iranTaxNote, type IranTreatment } from './iran-tax';
import { DEFAULTS } from '../config/constants';

const EN_19 = 'In accordance with § 19 of the German VAT Act (UStG), no VAT is charged (small business).';
const FA_19 = 'طبق بند ۱۹ قانون مالیات بر ارزش افزوده آلمان (UStG، کسب‌وکار کوچک)، مالیات بر ارزش افزوده محاسبه نمی‌شود.';

export function buildTaxNote(o: {
  lang: 'de' | 'en' | 'fa';
  iran: IranTreatment | null;
  taxRateBp: number;
  germanText?: string | null;
  publicNote?: string | null;
}): string {
  const de19 = o.germanText?.trim() || DEFAULTS.taxExemptionText;
  let note = '';
  if (o.iran) note = iranTaxNote(o.iran, o.lang);
  else if (o.taxRateBp === 0) note = o.lang === 'de' ? de19 : o.lang === 'en' ? EN_19 : `${FA_19}\n${de19}`;
  return [note, o.publicNote?.trim()].filter(Boolean).join('\n');
}
