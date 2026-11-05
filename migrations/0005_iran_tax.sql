-- Iranian tax rules for rial/toman invoices.
--
-- Seller: micro business (کسب‌وکار خرد, not VAT-registered → no VAT) or
-- VAT-registered (ثبت‌نام‌شده در نظام مالیات بر ارزش افزوده → VAT at the
-- configured rate, default 10% for 1405). Identification: national ID
-- (کد ملی for persons / شناسه ملی for legal entities), economic code
-- (کد اقتصادی) and optionally the Moadian tax-memory ID (شناسه یکتای حافظه مالیاتی).
ALTER TABLE seller_profiles ADD COLUMN iran_tax_status TEXT NOT NULL DEFAULT 'MICRO'
  CHECK (iran_tax_status IN ('MICRO', 'VAT_REGISTERED'));
ALTER TABLE seller_profiles ADD COLUMN national_id TEXT;
ALTER TABLE seller_profiles ADD COLUMN economic_code TEXT;
ALTER TABLE seller_profiles ADD COLUMN tax_memory_id TEXT;
ALTER TABLE seller_profiles ADD COLUMN iran_vat_rate_bp INTEGER NOT NULL DEFAULT 1000;

-- Buyer identification (required on Moadian "type 1" invoices).
ALTER TABLE customers ADD COLUMN national_id TEXT;
ALTER TABLE customers ADD COLUMN economic_code TEXT;

-- Per-invoice Iranian tax treatment, frozen at draft/issue time.
--   iran_tax_mode:     'MICRO' | 'VAT' (NULL for non-Iranian currencies)
--   iran_invoice_type: 1 (with buyer identity) | 2 (consumer, no buyer identity)
ALTER TABLE invoices ADD COLUMN iran_tax_mode TEXT;
ALTER TABLE invoices ADD COLUMN iran_invoice_type INTEGER;
