import { one, all, run } from '../client';
import { newId } from '../../lib/ids';

export interface SellerProfile {
  id: string;
  version: number;
  is_active: number;
  full_name: string;
  business_name: string | null;
  job_title: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string | null;
  website: string | null;
  steuernummer: string | null;
  ust_idnr: string | null;
  kleinunternehmer_id: string | null;
  account_holder: string;
  iban: string;
  bic: string | null;
  bank_name: string | null;
  logo_r2_key: string | null;
  signature_r2_key: string | null;
  default_payment_days: number;
  footer_text: string | null;
  default_rights_text: string | null;
  tax_exemption_text: string;
  invoice_number_prefix: string;
  iran_tax_status: 'MICRO' | 'VAT_REGISTERED';
  national_id: string | null;
  economic_code: string | null;
  tax_memory_id: string | null;
  iran_vat_rate_bp: number;
  created_at: string;
  updated_at: string;
}

export type SellerInput = Omit<SellerProfile, 'id' | 'version' | 'is_active' | 'created_at' | 'updated_at'>;

export function getActiveSeller(db: D1Database): Promise<SellerProfile | null> {
  return one<SellerProfile>(db, `SELECT * FROM seller_profiles WHERE is_active = 1 ORDER BY version DESC LIMIT 1`);
}

export function getSellerById(db: D1Database, id: string): Promise<SellerProfile | null> {
  return one<SellerProfile>(db, `SELECT * FROM seller_profiles WHERE id = ?1`, id);
}

export function listSellerVersions(db: D1Database): Promise<SellerProfile[]> {
  return all<SellerProfile>(db, `SELECT * FROM seller_profiles ORDER BY version DESC`);
}

/**
 * Create a new active seller version. Editing never mutates prior versions, so
 * already-issued invoices (which hold a snapshot) are unaffected.
 */
export async function createSellerVersion(db: D1Database, input: SellerInput): Promise<SellerProfile> {
  const prev = await getActiveSeller(db);
  const version = (prev?.version ?? 0) + 1;
  const id = newId('sel');
  if (prev) await run(db, `UPDATE seller_profiles SET is_active = 0 WHERE id = ?1`, prev.id);
  await run(
    db,
    `INSERT INTO seller_profiles
       (id, version, is_active, full_name, business_name, job_title, street, postal_code, city, country,
        email, phone, website, steuernummer, ust_idnr, kleinunternehmer_id, account_holder, iban, bic,
        bank_name, logo_r2_key, signature_r2_key, default_payment_days, footer_text, default_rights_text,
        tax_exemption_text, invoice_number_prefix, iran_tax_status, national_id, economic_code,
        tax_memory_id, iran_vat_rate_bp)
     VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)`,
    id, version, input.full_name, input.business_name, input.job_title, input.street, input.postal_code,
    input.city, input.country, input.email, input.phone, input.website, input.steuernummer, input.ust_idnr,
    input.kleinunternehmer_id, input.account_holder, input.iban, input.bic, input.bank_name, input.logo_r2_key,
    input.signature_r2_key, input.default_payment_days, input.footer_text, input.default_rights_text,
    input.tax_exemption_text, input.invoice_number_prefix, input.iran_tax_status, input.national_id,
    input.economic_code, input.tax_memory_id, input.iran_vat_rate_bp,
  );
  return (await getSellerById(db, id))!;
}
