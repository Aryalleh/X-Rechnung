-- =============================================================================
-- Multi-currency + per-invoice language.
--
-- Adds an `invoice_language` column so an invoice can be rendered in German
-- (de) or Persian (fa). Currency selection already exists via invoices.currency
-- (now EUR | IRR | IRT | IRT_NEW). Amounts remain integer minor units of the
-- chosen currency (see src/config/currencies.ts).
-- =============================================================================

ALTER TABLE invoices ADD COLUMN invoice_language TEXT NOT NULL DEFAULT 'de';

-- Snapshot the currency + language into issued invoices for immutability.
ALTER TABLE invoices ADD COLUMN currency_snapshot TEXT;
