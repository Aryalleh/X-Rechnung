-- Contracts: generator (templates) + e-signature (Fill & Sign).
--
-- Template syntax (plain text, one block per line):
--   # Heading / ## Sub-heading, "1. " numbered clause, blank line = new paragraph
--   {{variable}}        filled when the contract is generated (customer, seller, custom values)
--   [[Label]]           filled by the CUSTOMER on the signing page
--   [[Label:date]] [[Label:number]] [[Label:checkbox]]
CREATE TABLE IF NOT EXISTS contract_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en', 'fa')),
  body        TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id                     TEXT PRIMARY KEY,
  contract_number        TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  language               TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en', 'fa')),
  template_id            TEXT,
  customer_id            TEXT REFERENCES customers(id),
  customer_snapshot_json TEXT,
  seller_snapshot_json   TEXT,
  body                   TEXT NOT NULL,          -- template text incl. {{variables}} (draft)
  variables_json         TEXT NOT NULL DEFAULT '{}',
  resolved_body          TEXT,                   -- frozen at send: variables substituted, [[fields]] kept
  content_hash           TEXT,                   -- SHA-256 of the frozen content + parties
  status                 TEXT NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'CANCELLED')),
  sign_token_hash        TEXT,
  sign_token_expires_at  TEXT,
  seller_signer_name     TEXT,
  seller_signature       TEXT,                   -- PNG data URL
  seller_signed_at       TEXT,
  field_values_json      TEXT,                   -- customer's [[field]] values
  signer_name            TEXT,
  signer_email           TEXT,
  signature              TEXT,                   -- customer's PNG data URL
  signed_at              TEXT,
  signer_ip              TEXT,
  signer_user_agent      TEXT,
  viewed_at              TEXT,
  viewer_ip              TEXT,
  sent_at                TEXT,
  sent_to_email          TEXT,
  signed_pdf_document_id TEXT,
  created_by             TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_status   ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_token ON contracts(sign_token_hash) WHERE sign_token_hash IS NOT NULL;

-- Starter templates (review with your own legal adviser before use).
INSERT OR IGNORE INTO contract_templates (id, name, language, sort_order, body) VALUES
('ctpl_de_service', 'Dienstleistungsvertrag (Videoproduktion)', 'de', 10,
'# Dienstleistungsvertrag

zwischen {{seller_name}}, {{seller_address}} – nachfolgend „Auftragnehmer“ –
und {{customer_name}}, {{customer_address}} – nachfolgend „Auftraggeber“.

## 1. Gegenstand
Der Auftragnehmer erbringt für den Auftraggeber folgende Leistungen: {{leistung}}.

## 2. Termine
Leistungszeitraum: {{zeitraum}}. Drehort: [[Drehort]]. Gewünschter Liefertermin: [[Liefertermin:date]].

## 3. Vergütung
Die Vergütung beträgt {{honorar}}. Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet, sofern der Auftragnehmer Kleinunternehmer ist.

## 4. Mitwirkung
Der Auftraggeber stellt alle für die Leistung nötigen Informationen, Zugänge und Drehgenehmigungen rechtzeitig bereit.

## 5. Nutzungsrechte
Nach vollständiger Zahlung erhält der Auftraggeber das einfache, zeitlich unbegrenzte Nutzungsrecht an den gelieferten Werken für folgende Zwecke: {{nutzung}}. Rohmaterial verbleibt beim Auftragnehmer.

## 6. Korrekturen
Im Honorar sind {{korrekturen}} Korrekturschleifen enthalten; weitere Änderungen werden nach Aufwand berechnet.

## 7. Stornierung
Bei Absage durch den Auftraggeber weniger als 7 Tage vor dem Termin werden 50 % der Vergütung fällig.

## 8. Schlussbestimmungen
Änderungen bedürfen der Textform. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam. Es gilt deutsches Recht.

[[Ich habe die Bedingungen gelesen und stimme zu:checkbox]]'),

('ctpl_en_service', 'Service agreement (video production)', 'en', 20,
'# Service Agreement

between {{seller_name}}, {{seller_address}} (the "Contractor")
and {{customer_name}}, {{customer_address}} (the "Client").

## 1. Scope
The Contractor provides the following services to the Client: {{services}}.

## 2. Schedule
Service period: {{period}}. Location: [[Location]]. Requested delivery date: [[Delivery date:date]].

## 3. Fee
The fee is {{fee}}. Invoices are payable within 14 days without deduction.

## 4. Cooperation
The Client provides all information, access and permits needed for the services in good time.

## 5. Usage rights
After full payment the Client receives a non-exclusive, perpetual right to use the delivered works for: {{usage}}. Raw footage remains with the Contractor.

## 6. Revisions
The fee includes {{revisions}} rounds of revisions; further changes are billed by time.

## 7. Cancellation
If the Client cancels less than 7 days before the scheduled date, 50 % of the fee is due.

## 8. Final provisions
Amendments must be made in text form. If any provision is invalid, the rest of the agreement remains in force. German law applies.

[[I have read and accept these terms:checkbox]]'),

('ctpl_fa_service', 'قرارداد خدمات (تولید ویدیو)', 'fa', 30,
'# قرارداد ارائهٔ خدمات

این قرارداد میان {{seller_name}} به نشانی {{seller_address}} که از این پس «مجری» نامیده می‌شود
و {{customer_name}} به نشانی {{customer_address}} که از این پس «کارفرما» نامیده می‌شود، منعقد می‌گردد.

## ماده ۱ — موضوع قرارداد
مجری خدمات زیر را برای کارفرما انجام می‌دهد: {{شرح_خدمات}}.

## ماده ۲ — زمان‌بندی
مدت انجام کار: {{مدت}}. محل فیلمبرداری: [[محل فیلمبرداری]]. تاریخ تحویل درخواستی: [[تاریخ تحویل:date]].

## ماده ۳ — مبلغ قرارداد
مبلغ کل قرارداد {{مبلغ}} است. پیش‌پرداخت: {{پیش_پرداخت}}. باقی‌مانده حداکثر ۱۴ روز پس از تحویل پرداخت می‌شود.

## ماده ۴ — تعهدات کارفرما
کارفرما اطلاعات، دسترسی‌ها و مجوزهای لازم را به‌موقع در اختیار مجری قرار می‌دهد.

## ماده ۵ — حق استفاده
پس از تسویهٔ کامل، کارفرما حق استفادهٔ غیرانحصاری و نامحدود از آثار تحویلی را برای این موارد دارد: {{نوع_استفاده}}. فایل‌های خام نزد مجری باقی می‌ماند.

## ماده ۶ — اصلاحات
تعداد {{تعداد_اصلاحات}} نوبت اصلاح در مبلغ قرارداد منظور شده است؛ اصلاحات بیشتر جداگانه محاسبه می‌شود.

## ماده ۷ — فسخ
در صورت لغو از سوی کارفرما کمتر از ۷ روز پیش از موعد، ۵۰٪ مبلغ قرارداد قابل پرداخت است.

## ماده ۸ — سایر شرایط
هرگونه تغییر باید به‌صورت کتبی باشد. بی‌اعتباری یک بند، سایر بندها را بی‌اعتبار نمی‌کند.

[[شرایط را خواندم و می‌پذیرم:checkbox]]');
