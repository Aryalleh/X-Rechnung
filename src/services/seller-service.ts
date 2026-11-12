import { assertIranSellerIssuable, cleanIranIds, isIranCurrency } from './iran-tax';
import type { z } from 'zod';
import { sellerProfileSchema, isValidIban, isValidShaba } from '../lib/schemas';
import {
  createSellerVersion, getActiveSeller, type SellerProfile, type SellerInput,
} from '../db/repositories/seller-repo';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';
import { DEFAULTS } from '../config/constants';

type SellerBody = z.infer<typeof sellerProfileSchema>;

export async function saveSellerProfile(
  db: D1Database,
  body: SellerBody,
  actorEmail: string,
  logoKey?: string | null,
  signatureKey?: string | null,
): Promise<SellerProfile> {
  if (body.iban && !isValidIban(body.iban)) throw new AppError('VALIDATION_ERROR', 'IBAN checksum invalid', { iban: 'invalid_iban' });
  if (body.shaba && !isValidShaba(body.shaba)) throw new AppError('VALIDATION_ERROR', 'Sheba checksum invalid', { shaba: 'invalid_shaba' });

  const input: SellerInput = {
    full_name: body.full_name,
    business_name: body.business_name ?? null,
    job_title: body.job_title,
    street: body.street,
    postal_code: body.postal_code,
    city: body.city,
    country: body.country,
    email: body.email,
    phone: body.phone ?? null,
    website: body.website ?? null,
    steuernummer: body.steuernummer ?? null,
    ust_idnr: body.ust_idnr ?? null,
    kleinunternehmer_id: body.kleinunternehmer_id ?? null,
    // DB columns are NOT NULL (pre-Sheba schema): store '' when only a Sheba is given.
    account_holder: body.account_holder?.trim() || '',
    iban: body.iban || '',
    bic: body.bic || null,
    bank_name: body.bank_name ?? null,
    logo_r2_key: logoKey ?? null,
    signature_r2_key: signatureKey ?? null,
    default_payment_days: body.default_payment_days,
    footer_text: body.footer_text ?? null,
    default_rights_text: body.default_rights_text ?? null,
    tax_exemption_text: body.tax_exemption_text,
    invoice_number_prefix: body.invoice_number_prefix,
    iran_tax_status: body.iran_tax_status,
    ...cleanIranIds(body),
    tax_memory_id: body.tax_memory_id?.trim() || null,
    iran_vat_rate_bp: body.iran_vat_rate_bp,
    iran_account_holder: body.iran_account_holder?.trim() || null,
    iran_bank_name: body.iran_bank_name?.trim() || null,
    shaba: body.shaba || null,
    iran_card_number: body.iran_card_number || null,
  };
  if (input.iran_tax_status === 'VAT_REGISTERED' && !input.economic_code) {
    throw new AppError('VALIDATION_ERROR', 'economic code required', { economic_code: 'iran_economic_code_required' });
  }

  const prev = await getActiveSeller(db);
  const profile = await createSellerVersion(db, input);
  await audit(db, {
    entityType: 'seller_profile',
    entityId: profile.id,
    eventType: prev ? 'SELLER_PROFILE_UPDATED' : 'SELLER_PROFILE_CREATED',
    actorEmail,
    metadata: { version: profile.version },
  });
  return profile;
}

/**
 * Validate that the active seller has the tax fields required to issue an
 * invoice (Steuernummer OR USt-IdNr OR Kleinunternehmer-ID + address).
 */
export function assertSellerIssuable(seller: SellerProfile | null, currency?: string): asserts seller is SellerProfile {
  if (!seller) throw new AppError('SELLER_INCOMPLETE', 'no seller profile');
  if (isIranCurrency(currency)) {
    // Iranian invoice: Iranian identity rules instead of German §14 UStG ones.
    if (!(seller.full_name && seller.street && seller.city)) throw new AppError('SELLER_INCOMPLETE');
    assertIranSellerIssuable(seller);
    return;
  }
  const hasTaxId = Boolean(seller.steuernummer || seller.ust_idnr || seller.kleinunternehmer_id);
  const hasAddress = Boolean(seller.full_name && seller.street && seller.postal_code && seller.city);
  if (!hasTaxId || !hasAddress) throw new AppError('SELLER_INCOMPLETE');
  if (!seller.tax_exemption_text?.trim()) throw new AppError('TAX_INCOMPLETE', 'missing §19 text');
}

/** Snapshot of the seller stored in an issued invoice. */
export function snapshotSeller(s: SellerProfile): Record<string, unknown> {
  return {
    version: s.version,
    full_name: s.full_name,
    business_name: s.business_name,
    job_title: s.job_title || DEFAULTS.jobTitle,
    street: s.street,
    postal_code: s.postal_code,
    city: s.city,
    country: s.country,
    email: s.email,
    phone: s.phone,
    website: s.website,
    steuernummer: s.steuernummer,
    ust_idnr: s.ust_idnr,
    kleinunternehmer_id: s.kleinunternehmer_id,
    account_holder: s.account_holder,
    iban: s.iban,
    bic: s.bic,
    bank_name: s.bank_name,
    logo_r2_key: s.logo_r2_key,
    footer_text: s.footer_text,
    tax_exemption_text: s.tax_exemption_text,
    iran_tax_status: s.iran_tax_status,
    national_id: s.national_id,
    economic_code: s.economic_code,
    tax_memory_id: s.tax_memory_id,
    iran_account_holder: s.iran_account_holder,
    iran_bank_name: s.iran_bank_name,
    shaba: s.shaba,
    iran_card_number: s.iran_card_number,
  };
}
