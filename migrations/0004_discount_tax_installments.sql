-- =============================================================================
-- Discounts (document-level), tax rate (VAT for businesses), advance payment
-- and installment schedules.
--
-- Serves Iranian freelancers, foreign freelancers and small Iranian businesses:
--   - Kleinunternehmer / tax-free: tax_rate_bp = 0 (+ §19 note for EUR/de).
--   - Businesses charging VAT (e.g. Iran 10%, Germany 19%): tax_rate_bp > 0.
-- All amounts remain integer minor units of the invoice currency.
-- =============================================================================

ALTER TABLE invoices ADD COLUMN discount_mode TEXT NOT NULL DEFAULT 'NONE';   -- NONE | PERCENT | FIXED
ALTER TABLE invoices ADD COLUMN discount_value INTEGER NOT NULL DEFAULT 0;     -- PERCENT: basis points (1000 = 10%); FIXED: minor units
ALTER TABLE invoices ADD COLUMN global_discount_cents INTEGER NOT NULL DEFAULT 0; -- computed document discount
ALTER TABLE invoices ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;        -- VAT rate in basis points (1900 = 19%)
ALTER TABLE invoices ADD COLUMN tax_amount_cents INTEGER NOT NULL DEFAULT 0;   -- computed VAT amount
ALTER TABLE invoices ADD COLUMN advance_paid_cents INTEGER NOT NULL DEFAULT 0; -- prepaid / Anzahlung before issue
ALTER TABLE invoices ADD COLUMN amount_due_cents INTEGER NOT NULL DEFAULT 0;   -- total − advance

CREATE TABLE IF NOT EXISTS invoice_installments (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  label        TEXT,
  due_date     TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  paid         INTEGER NOT NULL DEFAULT 0,
  paid_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_installments_invoice ON invoice_installments(invoice_id);
