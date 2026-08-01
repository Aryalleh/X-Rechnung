/**
 * Structured extraction from UBL and CII (EN 16931) invoice XML.
 *
 * For ZUGFeRD, the embedded XML is treated as the authoritative data source.
 * Amounts are converted to integer cents. Dates are normalized to YYYY-MM-DD.
 */
import type { XmlNode } from '../../lib/xml';
import { child, childrenByLocal, findPath, textAt, firstDescendant } from '../../lib/xml';
import { euroStringToCents } from '../../lib/money';
import type { EInvoiceFormat } from '../../config/constants';

export interface ExtractedLine {
  position: number;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  taxCategory: string | null;
}

export interface ExtractedInvoice {
  format: EInvoiceFormat;
  profileId: string | null;
  customizationId: string | null;
  documentType: string | null;
  supplierName: string | null;
  supplierAddress: string | null;
  supplierTaxId: string | null;
  supplierVatId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  serviceDate: string | null;
  servicePeriod: string | null;
  currency: string | null;
  netAmountCents: number | null;
  taxAmountCents: number | null;
  grossAmountCents: number | null;
  paymentTerms: string | null;
  iban: string | null;
  bic: string | null;
  buyerReference: string | null;
  purchaseOrderReference: string | null;
  contractReference: string | null;
  lines: ExtractedLine[];
}

function centsOrNull(v: string | undefined | null): number | null {
  if (!v) return null;
  try {
    return euroStringToCents(v);
  } catch {
    return null;
  }
}

function normDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // CII format 102
  return null;
}

function nz(s: string): string | null {
  return s.trim() ? s.trim() : null;
}

// ----------------------------- UBL --------------------------------------
function parseUbl(root: XmlNode): ExtractedInvoice {
  const supplierParty = findPath(root, ['AccountingSupplierParty', 'Party']);
  const supplierName =
    (supplierParty && textAt(supplierParty, ['PartyLegalEntity', 'RegistrationName'])) ||
    (supplierParty && textAt(supplierParty, ['PartyName', 'Name'])) || '';
  const supplierAddr = supplierParty && child(supplierParty, 'PostalAddress');
  const address = supplierAddr
    ? [textAt(supplierAddr, ['StreetName']), textAt(supplierAddr, ['PostalZone']), textAt(supplierAddr, ['CityName']), textAt(supplierAddr, ['Country', 'IdentificationCode'])]
        .filter(Boolean).join(', ')
    : '';

  let vatId: string | null = null;
  let taxId: string | null = null;
  if (supplierParty) {
    for (const scheme of childrenByLocal(supplierParty, 'PartyTaxScheme')) {
      const id = textAt(scheme, ['CompanyID']);
      const schemeName = textAt(scheme, ['TaxScheme', 'ID']).toUpperCase();
      if (schemeName.includes('VAT') || /^[A-Z]{2}/.test(id)) vatId = id || vatId;
      else taxId = id || taxId;
    }
  }

  const legal = child(root, 'LegalMonetaryTotal');
  const net = legal ? textAt(legal, ['LineExtensionAmount']) : '';
  const gross = legal ? textAt(legal, ['TaxInclusiveAmount']) : '';
  const payable = legal ? textAt(legal, ['PayableAmount']) : '';
  const taxTotal = child(root, 'TaxTotal');
  const taxAmount = taxTotal ? textAt(taxTotal, ['TaxAmount']) : '';

  const paymentMeans = child(root, 'PaymentMeans');
  const account = paymentMeans && child(paymentMeans, 'PayeeFinancialAccount');
  const iban = account ? textAt(account, ['ID']) : '';
  const bic = account ? textAt(account, ['FinancialInstitutionBranch', 'ID']) : '';
  const dueDate = textAt(root, ['DueDate']) || (paymentMeans ? textAt(paymentMeans, ['PaymentDueDate']) : '');

  const lines: ExtractedLine[] = childrenByLocal(root, 'InvoiceLine').map((ln, i) => {
    const item = child(ln, 'Item');
    const price = child(ln, 'Price');
    return {
      position: Number(textAt(ln, ['ID'])) || i + 1,
      description: (item && textAt(item, ['Name'])) || (item && textAt(item, ['Description'])) || '',
      quantity: textAt(ln, ['InvoicedQuantity']) || '1',
      unit: child(ln, 'InvoicedQuantity')?.attributes.unitCode ?? '',
      unitPriceCents: centsOrNull(price ? textAt(price, ['PriceAmount']) : null),
      lineTotalCents: centsOrNull(textAt(ln, ['LineExtensionAmount'])),
      taxCategory: item ? textAt(item, ['ClassifiedTaxCategory', 'ID']) || null : null,
    };
  });

  return {
    format: 'XRECHNUNG_UBL',
    profileId: nz(textAt(root, ['ProfileID'])),
    customizationId: nz(textAt(root, ['CustomizationID'])),
    documentType: nz(textAt(root, ['InvoiceTypeCode'])),
    supplierName: nz(supplierName),
    supplierAddress: nz(address),
    supplierTaxId: taxId,
    supplierVatId: vatId,
    invoiceNumber: nz(textAt(root, ['ID'])),
    invoiceDate: normDate(textAt(root, ['IssueDate'])),
    dueDate: normDate(dueDate),
    serviceDate: null,
    servicePeriod: null,
    currency: nz(textAt(root, ['DocumentCurrencyCode'])),
    netAmountCents: centsOrNull(net),
    taxAmountCents: centsOrNull(taxAmount),
    grossAmountCents: centsOrNull(gross || payable),
    paymentTerms: nz(textAt(root, ['PaymentTerms', 'Note'])),
    iban: nz(iban),
    bic: nz(bic),
    buyerReference: nz(textAt(root, ['BuyerReference'])),
    purchaseOrderReference: nz(textAt(root, ['OrderReference', 'ID'])),
    contractReference: nz(textAt(root, ['ContractDocumentReference', 'ID'])),
    lines,
  };
}

// ----------------------------- CII --------------------------------------
function parseCii(root: XmlNode, format: EInvoiceFormat): ExtractedInvoice {
  const doc = child(root, 'ExchangedDocument');
  const tx = child(root, 'SupplyChainTradeTransaction');
  const agreement = tx && child(tx, 'ApplicableHeaderTradeAgreement');
  const settlement = tx && child(tx, 'ApplicableHeaderTradeSettlement');
  const seller = agreement && child(agreement, 'SellerTradeParty');

  const sellerAddr = seller && child(seller, 'PostalTradeAddress');
  const address = sellerAddr
    ? [textAt(sellerAddr, ['LineOne']), textAt(sellerAddr, ['PostcodeCode']), textAt(sellerAddr, ['CityName']), textAt(sellerAddr, ['CountryID'])]
        .filter(Boolean).join(', ')
    : '';

  let vatId: string | null = null;
  let taxId: string | null = null;
  if (seller) {
    for (const reg of childrenByLocal(seller, 'SpecifiedTaxRegistration')) {
      const idNode = child(reg, 'ID');
      const scheme = idNode?.attributes.schemeID?.toUpperCase() ?? '';
      if (scheme === 'VA') vatId = idNode?.text ?? vatId;
      else if (scheme === 'FC') taxId = idNode?.text ?? taxId;
    }
  }

  const summation = settlement && findPath(settlement, ['SpecifiedTradeSettlementHeaderMonetarySummation']);
  const net = summation ? textAt(summation, ['LineTotalAmount']) : '';
  const tax = summation ? textAt(summation, ['TaxTotalAmount']) : '';
  const gross = summation ? textAt(summation, ['GrandTotalAmount']) : '';
  const payable = summation ? textAt(summation, ['DuePayableAmount']) : '';

  const paymentMeans = settlement && child(settlement, 'SpecifiedTradeSettlementPaymentMeans');
  const payeeAccount = paymentMeans && child(paymentMeans, 'PayeePartyCreditorFinancialAccount');
  const iban = payeeAccount ? textAt(payeeAccount, ['IBANID']) || textAt(payeeAccount, ['ProprietaryID']) : '';
  const payeeInst = paymentMeans && child(paymentMeans, 'PayeeSpecifiedCreditorFinancialInstitution');
  const bic = payeeInst ? textAt(payeeInst, ['BICID']) : '';

  const terms = settlement && child(settlement, 'SpecifiedTradePaymentTerms');
  const dueDate = terms ? textAt(terms, ['DueDateDateTime', 'DateTimeString']) : '';

  const issue = doc && textAt(doc, ['IssueDateTime', 'DateTimeString']);

  const lines: ExtractedLine[] = tx
    ? childrenByLocal(tx, 'IncludedSupplyChainTradeLineItem').map((ln, i) => {
        const prod = child(ln, 'SpecifiedTradeProduct');
        const lineAgreement = child(ln, 'SpecifiedLineTradeAgreement');
        const price = lineAgreement && child(lineAgreement, 'NetPriceProductTradePrice');
        const delivery = child(ln, 'SpecifiedLineTradeDelivery');
        const lineSettle = child(ln, 'SpecifiedLineTradeSettlement');
        const lineSum = lineSettle && findPath(lineSettle, ['SpecifiedTradeSettlementLineMonetarySummation']);
        const qtyNode = delivery && child(delivery, 'BilledQuantity');
        return {
          position: i + 1,
          description: prod ? textAt(prod, ['Name']) : '',
          quantity: qtyNode?.text || '1',
          unit: qtyNode?.attributes.unitCode ?? '',
          unitPriceCents: centsOrNull(price ? textAt(price, ['ChargeAmount']) : null),
          lineTotalCents: centsOrNull(lineSum ? textAt(lineSum, ['LineTotalAmount']) : null),
          taxCategory: null,
        };
      })
    : [];

  const guideline = root && firstDescendant(root, 'GuidelineSpecifiedDocumentContextParameter');
  const customization = guideline ? textAt(guideline, ['ID']) : '';

  return {
    format,
    profileId: nz(customization),
    customizationId: nz(customization),
    documentType: doc ? nz(textAt(doc, ['TypeCode'])) : null,
    supplierName: seller ? nz(textAt(seller, ['Name'])) : null,
    supplierAddress: nz(address),
    supplierTaxId: taxId,
    supplierVatId: vatId,
    invoiceNumber: doc ? nz(textAt(doc, ['ID'])) : null,
    invoiceDate: normDate(issue || ''),
    dueDate: normDate(dueDate),
    serviceDate: null,
    servicePeriod: null,
    currency: settlement ? nz(textAt(settlement, ['InvoiceCurrencyCode'])) : null,
    netAmountCents: centsOrNull(net),
    taxAmountCents: centsOrNull(tax),
    grossAmountCents: centsOrNull(gross || payable),
    paymentTerms: terms ? nz(textAt(terms, ['Description'])) : null,
    iban: nz(iban),
    bic: nz(bic),
    buyerReference: agreement ? nz(textAt(agreement, ['BuyerReference'])) : null,
    purchaseOrderReference: agreement ? nz(textAt(findPath(agreement, ['BuyerOrderReferencedDocument']) ?? agreement, ['IssuerAssignedID'])) : null,
    contractReference: null,
    lines,
  };
}

export function parseInvoiceXml(root: XmlNode, format: EInvoiceFormat): ExtractedInvoice {
  if (root.localName === 'Invoice') return parseUbl(root);
  if (root.localName === 'CrossIndustryInvoice' || root.localName === 'CrossIndustryDocument') {
    return parseCii(root, format === 'ZUGFERD' ? 'ZUGFERD' : format);
  }
  throw new Error(`Unsupported invoice root: ${root.localName}`);
}
