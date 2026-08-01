/** Basic (in-Worker) validation + strict (KoSIT) orchestration. */
import type { Env } from '../../config/env';
import type { ExtractedInvoice } from './parse';
import { isValidIban } from '../../lib/schemas';
import { getEInvoiceSettings } from '../settings-service';
import { getSecret } from '../secret-service';
import {
  type StrictValidator, type StrictValidationOutcome,
  UnconfiguredValidator, KositHttpValidator,
} from './kosit-adapter';

export interface BasicValidationOutcome {
  status: 'BASIC_VALID' | 'BASIC_INVALID';
  messages: string[];
}

/** Cross-field basic checks. Structural well-formedness is already guaranteed
 * (the XML was parsed by the hardened parser before we get here). */
export function basicValidate(x: ExtractedInvoice): BasicValidationOutcome {
  const messages: string[] = [];
  if (!x.invoiceNumber) messages.push('شماره فاکتور موجود نیست (BR-2).');
  if (!x.supplierName) messages.push('نام فروشنده موجود نیست (BR-6).');
  if (!x.invoiceDate) messages.push('تاریخ فاکتور موجود نیست (BR-3).');
  if (!x.currency) messages.push('ارز فاکتور موجود نیست (BR-5).');
  if (x.grossAmountCents === null) messages.push('مبلغ نهایی موجود نیست (BR-14).');

  // Line-sum sanity check against the net line total.
  if (x.lines.length > 0 && x.netAmountCents !== null) {
    const sum = x.lines.reduce((acc, l) => acc + (l.lineTotalCents ?? 0), 0);
    if (Math.abs(sum - x.netAmountCents) > 1) {
      messages.push(`جمع ردیف‌ها (${sum}) با مبلغ خالص (${x.netAmountCents}) هم‌خوانی ندارد.`);
    }
  }

  if (x.iban && !isValidIban(x.iban)) messages.push('IBAN از نظر ساختار معتبر نیست.');

  return { status: messages.length === 0 ? 'BASIC_VALID' : 'BASIC_INVALID', messages };
}

/** Build the configured strict validator (or an unconfigured one). */
export async function buildStrictValidator(env: Env): Promise<StrictValidator> {
  const settings = await getEInvoiceSettings(env.DB);
  if (!settings.kosit_url) return new UnconfiguredValidator();
  const apiKey = await getSecret(env, 'kosit_api_key');
  return new KositHttpValidator({
    url: settings.kosit_url,
    apiKey,
    timeoutMs: settings.kosit_timeout_ms,
    retries: settings.kosit_retries,
  });
}

/** Overridable strict validator for tests. */
let strictOverride: StrictValidator | null = null;
export function setStrictValidator(v: StrictValidator | null): void {
  strictOverride = v;
}

export async function strictValidate(env: Env, xml: string): Promise<StrictValidationOutcome> {
  const validator = strictOverride ?? (await buildStrictValidator(env));
  return validator.validate(xml);
}
