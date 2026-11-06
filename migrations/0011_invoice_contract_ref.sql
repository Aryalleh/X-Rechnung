-- Link an invoice to the signed contract it bills (shown on the PDF as "Vertrag").
ALTER TABLE invoices ADD COLUMN contract_reference TEXT;
