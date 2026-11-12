-- Iranian bank account for toman/rial invoices.
--
-- EUR invoices print the German IBAN/BIC (existing columns); IRR/IRT invoices
-- print the Iranian Sheba (شبا, IR + 24 digits, IBAN mod-97 checksum), the
-- bank name, the account holder and optionally the 16-digit card number.
ALTER TABLE seller_profiles ADD COLUMN iran_account_holder TEXT;
ALTER TABLE seller_profiles ADD COLUMN iran_bank_name TEXT;
ALTER TABLE seller_profiles ADD COLUMN shaba TEXT;
ALTER TABLE seller_profiles ADD COLUMN iran_card_number TEXT;
