/** Zod schemas — all inbound payloads are validated before touching D1. */
import { z } from 'zod';
import { UNITS, PAYMENT_METHODS, TAX_SCENARIOS, DOCUMENT_TYPES } from '../config/constants';

const cents = z.number().int();
const quantity = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d+)?$/, 'مقدار نامعتبر است');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'تاریخ نامعتبر است');

// IBAN structural check (not a full mod-97 check here; service layer does mod-97).
const ibanRegex = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const bicRegex = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export const sellerProfileSchema = z.object({
  full_name: z.string().min(1),
  business_name: z.string().optional(),
  job_title: z.string().min(1),
  street: z.string().min(1),
  postal_code: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2).default('DE'),
  email: z.string().email(),
  phone: z.string().optional(),
  website: z.string().optional(),
  steuernummer: z.string().optional(),
  ust_idnr: z.string().optional(),
  kleinunternehmer_id: z.string().optional(),
  account_holder: z.string().min(1),
  iban: z.string().transform((s) => s.replace(/\s/g, '').toUpperCase()).pipe(z.string().regex(ibanRegex, 'IBAN نامعتبر است')),
  bic: z.string().transform((s) => s.replace(/\s/g, '').toUpperCase()).pipe(z.string().regex(bicRegex)).optional().or(z.literal('')),
  bank_name: z.string().optional(),
  default_payment_days: z.number().int().min(0).max(365).default(14),
  footer_text: z.string().optional(),
  default_rights_text: z.string().optional(),
  tax_exemption_text: z.string().min(1, 'متن §19 نمی‌تواند خالی باشد'),
  invoice_number_prefix: z.string().min(1).default('RE'),
}).refine(
  (v) => Boolean(v.steuernummer || v.ust_idnr || v.kleinunternehmer_id),
  { message: 'یکی از Steuernummer، USt-IdNr یا Kleinunternehmer-ID الزامی است', path: ['steuernummer'] },
);

export const customerSchema = z.object({
  customer_code: z.string().trim().min(1).optional(),
  customer_type: z.enum(['BUSINESS', 'PRIVATE']).default('BUSINESS'),
  company_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  contact_person: z.string().optional(),
  street: z.string().optional(),
  postal_code: z.string().optional(),
  city: z.string().optional(),
  country: z.string().length(2).default('DE'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  ust_idnr: z.string().optional(),
  steuernummer: z.string().optional(),
  leitweg_id: z.string().optional(),
  buyer_reference: z.string().optional(),
  order_reference: z.string().optional(),
  payment_days: z.number().int().min(0).max(365).optional(),
  invoice_language: z.string().default('de'),
  delivery_method: z.enum(['EMAIL', 'MANUAL', 'POST']).default('EMAIL'),
  internal_note: z.string().optional(),
  is_active: z.boolean().default(true),
}).refine((v) => v.company_name || v.last_name, {
  message: 'نام شرکت یا نام خانوادگی الزامی است',
  path: ['company_name'],
});

export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity_decimal: quantity.default('1'),
  unit: z.enum(UNITS).default('Pauschale'),
  unit_price_cents: cents,
  discount_cents: cents.default(0),
  rights_text: z.string().optional(),
});

export const invoiceDraftSchema = z.object({
  customer_id: z.string().optional(),
  customer_code: z.string().optional(),
  project_number: z.string().optional(),
  project_name: z.string().optional(),
  invoice_date: isoDate.optional(),
  service_date: isoDate.optional(),
  service_period_start: isoDate.optional(),
  service_period_end: isoDate.optional(),
  due_date: isoDate.optional(),
  currency: z.enum(['EUR', 'IRR', 'IRT', 'IRT_NEW']).default('EUR'),
  invoice_language: z.enum(['de', 'fa', 'en']).default('de'),
  tax_scenario: z.enum(TAX_SCENARIOS).default('KLEINUNTERNEHMER_DE'),
  document_type: z.enum(DOCUMENT_TYPES).default('RECHNUNG'),
  buyer_reference: z.string().optional(),
  purchase_order_reference: z.string().optional(),
  order_reference: z.string().optional(),
  public_note: z.string().optional(),
  internal_note: z.string().optional(),
  items: z.array(invoiceItemSchema).default([]),
});

export const paymentSchema = z.object({
  payment_date: isoDate,
  amount_cents: cents.positive(),
  payment_method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  bank_reference: z.string().optional(),
  note: z.string().optional(),
  allow_overpay: z.boolean().default(false),
});

export const serviceTemplateSchema = z.object({
  name: z.string().min(1),
  default_description: z.string().min(1),
  unit: z.enum(UNITS).default('Pauschale'),
  default_price_cents: cents.default(0),
  category: z.string().optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

// ---- Setup wizard ----
export const setupStep1Schema = z.object({
  setup_token: z.string().min(1),
  owner_name: z.string().min(1),
  owner_email: z.string().email(),
  recovery_email: z.string().email().optional().or(z.literal('')),
  locale: z.string().default('fa'),
  timezone: z.string().default('Europe/Berlin'),
  /** Installation profile: Persian-only, German-only, or comprehensive. */
  invoice_mode: z.enum(['fa', 'de', 'both']).default('both'),
});

export const emailChannelSchema = z.object({
  channel_type: z.enum(['INBOUND', 'OUTBOUND']),
  local_part: z.string().optional(),
  domain: z.string().optional(),
  email_address: z.string().email(),
  provider: z.enum(['CLOUDFLARE_EMAIL_SERVICE', 'EXTERNAL_EMAIL_PROVIDER', 'EMAIL_ROUTING', 'DISABLED']).optional(),
  is_default: z.boolean().default(false),
  max_size_bytes: z.number().int().positive().optional(),
});

export const settingUpdateSchema = z.object({
  group: z.enum(['GENERAL', 'SELLER', 'INVOICE', 'EMAIL_INBOUND', 'EMAIL_OUTBOUND', 'EINVOICE', 'SECURITY', 'CLOUDFLARE', 'ARCHIVE', 'LOCALIZATION']),
  key: z.string().min(1),
  value: z.unknown(),
  is_secret: z.boolean().default(false),
  reason: z.string().optional(),
});

/** Full IBAN mod-97 validation used by the service layer. */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s/g, '').toUpperCase();
  if (!ibanRegex.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
