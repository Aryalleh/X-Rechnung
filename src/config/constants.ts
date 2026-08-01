/** Non-hardcoded-business constants: enums, defaults, and static German text. */

export const DEFAULTS = {
  locale: 'fa',
  invoiceLanguage: 'de',
  timezone: 'Europe/Berlin',
  currency: 'EUR',
  country: 'DE',
  dateFormat: 'DD.MM.YYYY',
  paymentDays: 14,
  numberDigits: 6,
  jobTitle: 'Videograf, Videoeditor und Videoproduzent',
  taxExemptionText: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  prefixRechnung: 'RE',
  prefixStorno: 'ST',
  prefixGutschrift: 'GS',
  retentionYears: 8,
} as const;

export const DOCUMENT_TYPES = ['RECHNUNG', 'STORNORECHNUNG', 'GUTSCHRIFT'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PREFIX_BY_TYPE: Record<DocumentType, keyof typeof DEFAULTS> = {
  RECHNUNG: 'prefixRechnung',
  STORNORECHNUNG: 'prefixStorno',
  GUTSCHRIFT: 'prefixGutschrift',
};

export const INVOICE_STATUSES = [
  'DRAFT', 'READY_TO_ISSUE', 'ISSUING', 'ISSUED', 'SENT',
  'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLATION_PENDING', 'CANCELLED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const TAX_SCENARIOS = [
  'KLEINUNTERNEHMER_DE', 'REVERSE_CHARGE_EU_B2B', 'NON_EU_SERVICE', 'CUSTOM_TAX_SCENARIO',
] as const;
export type TaxScenario = (typeof TAX_SCENARIOS)[number];

export const UNITS = ['Stunde', 'Tag', 'Pauschale', 'Stück', 'Kilometer', 'Projekt', 'Minute'] as const;
export type Unit = (typeof UNITS)[number];

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'PAYPAL', 'CARD', 'OTHER'] as const;

export const EINVOICE_FORMATS = [
  'XRECHNUNG_UBL', 'XRECHNUNG_CII', 'ZUGFERD', 'EN16931_XML', 'PDF_PLAIN', 'UNKNOWN',
] as const;
export type EInvoiceFormat = (typeof EINVOICE_FORMATS)[number];

export const VALIDATION_STATUSES = [
  'PENDING', 'BASIC_VALID', 'BASIC_INVALID', 'STRICT_VALID', 'STRICT_INVALID',
  'BASIC_CHECK_ONLY', 'UNSUPPORTED_FORMAT', 'PROCESSING_ERROR',
] as const;

/** Nutzungsrechte presets. */
export const RIGHTS_PRESETS = [
  'Keine gesonderte Rechteübertragung',
  'Einfache Nutzungsrechte',
  'Ausschließliche Nutzungsrechte',
  'Zeitlich begrenzt',
  'Zeitlich unbegrenzt',
  'Räumlich begrenzt',
  'Räumlich unbegrenzt',
  'Website',
  'Social Media',
  'Paid Advertising',
  'TV',
  'Kino',
  'Interne Nutzung',
] as const;

/** Common embedded XML filenames inside ZUGFeRD/Factur-X PDFs. */
export const ZUGFERD_XML_NAMES = [
  'factur-x.xml', 'zugferd-invoice.xml', 'ZUGFeRD-invoice.xml', 'xrechnung.xml',
] as const;

/** Upload limits (bytes). Overridable per e-invoice settings; these are hard ceilings. */
export const UPLOAD_LIMITS = {
  maxEmailBytes: 25 * 1024 * 1024,
  maxAttachmentBytes: 15 * 1024 * 1024,
  maxLogoBytes: 2 * 1024 * 1024,
} as const;

/** Allowed upload MIME types with expected magic-byte signatures. */
export const FILE_SIGNATURES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'application/xml': [[0x3c, 0x3f, 0x78, 0x6d, 0x6c], [0xef, 0xbb, 0xbf], [0x3c]], // <?xml / BOM / <
  'text/xml': [[0x3c, 0x3f, 0x78, 0x6d, 0x6c], [0x3c]],
  'application/zip': [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]], // PK..
  'message/rfc822': [], // .eml — no reliable magic, validated structurally
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
};

/** German invoice static labels. */
export const DE_LABELS = {
  rechnung: 'RECHNUNG',
  stornorechnung: 'STORNORECHNUNG',
  gutschrift: 'GUTSCHRIFT',
  entwurf: 'ENTWURF',
  kundennummer: 'Kundennummer',
  rechnungsnummer: 'Rechnungsnummer',
  rechnungsdatum: 'Rechnungsdatum',
  leistungsdatum: 'Leistungsdatum',
  leistungszeitraum: 'Leistungszeitraum',
  projekt: 'Projekt',
  bestellnummer: 'Bestellnummer',
  rechnungsbetrag: 'Rechnungsbetrag',
  gesamtbetrag: 'Gesamtbetrag',
  faelligkeit: 'Zahlbar bis',
  iban: 'IBAN',
  bic: 'BIC',
  kontoinhaber: 'Kontoinhaber',
  verwendungszweck: 'Verwendungszweck',
  pos: 'Pos.',
  beschreibung: 'Beschreibung',
  menge: 'Menge',
  einheit: 'Einheit',
  einzelpreis: 'Einzelpreis',
  betrag: 'Betrag',
} as const;
