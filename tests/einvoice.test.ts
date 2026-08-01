import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { parseXml } from '../src/lib/xml';
import { classifyXml } from '../src/services/einvoice/detect';
import { parseInvoiceXml } from '../src/services/einvoice/parse';
import { basicValidate } from '../src/services/einvoice/validate';

if (!globalThis.crypto) (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_2.3</cbc:CustomizationID>
  <cbc:ID>RE-2026-000123</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DueDate>2026-08-15</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>04011000-12345-34</cbc:BuyerReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>Muster Film GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
    <cac:PostalAddress><cbc:StreetName>Filmstr 1</cbc:StreetName><cbc:PostalZone>10115</cbc:PostalZone><cbc:CityName>Berlin</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>DE89370400440532013000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount>0.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>1250.00</cbc:LineExtensionAmount><cbc:TaxInclusiveAmount>1250.00</cbc:TaxInclusiveAmount><cbc:PayableAmount>1250.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount>1250.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Imagefilm Produktion</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>1250.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram" xmlns:udt="urn:udt">
  <rsm:ExchangedDocument><ram:ID>RE-2026-000900</ram:ID><ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260801</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Studio CII</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>80331</ram:PostcodeCode><ram:CityName>München</ram:CityName></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE987654321</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>500.00</ram:LineTotalAmount><ram:TaxTotalAmount>0.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>500.00</ram:GrandTotalAmount><ram:DuePayableAmount>500.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

describe('e-invoice extraction', () => {
  it('classifies and parses UBL XRechnung', () => {
    const root = parseXml(UBL);
    expect(classifyXml(root)).toBe('XRECHNUNG_UBL');
    const x = parseInvoiceXml(root, 'XRECHNUNG_UBL');
    expect(x.invoiceNumber).toBe('RE-2026-000123');
    expect(x.invoiceDate).toBe('2026-08-01');
    expect(x.currency).toBe('EUR');
    expect(x.supplierName).toBe('Muster Film GmbH');
    expect(x.supplierVatId).toBe('DE123456789');
    expect(x.grossAmountCents).toBe(125000);
    expect(x.iban).toBe('DE89370400440532013000');
    expect(x.buyerReference).toBe('04011000-12345-34');
    expect(x.lines).toHaveLength(1);
    expect(basicValidate(x).status).toBe('BASIC_VALID');
  });

  it('classifies and parses CII', () => {
    const root = parseXml(CII);
    expect(classifyXml(root)).toBe('EN16931_XML');
    const x = parseInvoiceXml(root, 'ZUGFERD');
    expect(x.invoiceNumber).toBe('RE-2026-000900');
    expect(x.invoiceDate).toBe('2026-08-01'); // format 102 normalized
    expect(x.supplierName).toBe('Studio CII');
    expect(x.supplierVatId).toBe('DE987654321');
    expect(x.grossAmountCents).toBe(50000);
    expect(x.currency).toBe('EUR');
  });

  it('basic validation flags missing invoice number', () => {
    const root = parseXml(UBL.replace('<cbc:ID>RE-2026-000123</cbc:ID>', ''));
    const x = parseInvoiceXml(root, 'XRECHNUNG_UBL');
    const result = basicValidate(x);
    expect(result.status).toBe('BASIC_INVALID');
    expect(result.messages.join(' ')).toContain('شماره فاکتور');
  });
});
