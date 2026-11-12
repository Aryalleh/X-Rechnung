-- Separate service templates (Leistungsvorlagen / الگوها) per market.
--   market   'DE' → German text, EUR price  — offered on EUR invoices only
--            'IR' → Persian text, rial/toman price — offered on IRR/IRT invoices only
--   currency the currency default_price_cents is stored in (EUR, IRR, IRT, IRT_NEW)
-- All templates created so far were German EUR templates.
ALTER TABLE service_templates ADD COLUMN market TEXT NOT NULL DEFAULT 'DE' CHECK (market IN ('DE', 'IR'));
ALTER TABLE service_templates ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'IRR', 'IRT', 'IRT_NEW'));
CREATE INDEX IF NOT EXISTS idx_templates_market ON service_templates(market, is_active);
