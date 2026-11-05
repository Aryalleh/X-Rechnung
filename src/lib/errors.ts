/** Typed application errors with localized (fa/de/en) user-facing messages. */

export type ErrorCode =
  | 'SETUP_REQUIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INVOICE_LOCKED'
  | 'CUSTOMER_CODE_TAKEN'
  | 'CUSTOMER_NOT_FOUND'
  | 'SELLER_INCOMPLETE'
  | 'TAX_INCOMPLETE'
  | 'NOT_STRUCTURED_EINVOICE'
  | 'INVALID_XML'
  | 'VALIDATOR_NOT_CONFIGURED'
  | 'DUPLICATE_INVOICE'
  | 'PDF_FAILED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA'
  | 'INTERNAL';

/** Persian user-facing messages (technical detail is kept out of these). */
export const USER_MESSAGES: Record<ErrorCode, string> = {
  SETUP_REQUIRED: 'راه‌اندازی اولیه سیستم هنوز کامل نشده است.',
  UNAUTHORIZED: 'دسترسی مجاز نیست. لطفاً وارد شوید.',
  FORBIDDEN: 'شما اجازه انجام این عملیات را ندارید.',
  NOT_FOUND: 'مورد درخواستی پیدا نشد.',
  VALIDATION_ERROR: 'اطلاعات واردشده معتبر نیست.',
  CONFLICT: 'این عملیات با وضعیت فعلی سازگار نیست.',
  INVOICE_LOCKED: 'فاکتور صادرشده قابل ویرایش نیست. برای اصلاح، Stornorechnung ایجاد کنید.',
  CUSTOMER_CODE_TAKEN: 'این شماره مشتری قبلاً استفاده شده است.',
  CUSTOMER_NOT_FOUND: 'مشتری با این کد پیدا نشد.',
  SELLER_INCOMPLETE: 'اطلاعات مالیاتی فریلنسر کامل نیست.',
  TAX_INCOMPLETE: 'اطلاعات مالیاتی فاکتور کامل نیست.',
  NOT_STRUCTURED_EINVOICE: 'فایل دریافت‌شده E-Rechnung ساختاریافته نیست.',
  INVALID_XML: 'XML فایل معتبر نیست.',
  VALIDATOR_NOT_CONFIGURED: 'اعتبارسنجی رسمی تنظیم نشده است.',
  DUPLICATE_INVOICE: 'این فاکتور احتمالاً قبلاً دریافت شده است.',
  PDF_FAILED: 'PDF تولید نشد؛ شماره رزروشده دوباره استفاده نخواهد شد.',
  RATE_LIMITED: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید.',
  PAYLOAD_TOO_LARGE: 'حجم فایل بیش از حد مجاز است.',
  UNSUPPORTED_MEDIA: 'نوع فایل پشتیبانی نمی‌شود.',
  INTERNAL: 'خطای داخلی سیستم رخ داد.',
};

export type UiLang = 'fa' | 'de' | 'en';

const MESSAGES_DE: Record<ErrorCode, string> = {
  SETUP_REQUIRED: 'Die Ersteinrichtung ist noch nicht abgeschlossen.',
  UNAUTHORIZED: 'Kein Zugriff. Bitte melden Sie sich an.',
  FORBIDDEN: 'Sie sind für diese Aktion nicht berechtigt.',
  NOT_FOUND: 'Der angeforderte Eintrag wurde nicht gefunden.',
  VALIDATION_ERROR: 'Die Eingaben sind ungültig.',
  CONFLICT: 'Diese Aktion ist im aktuellen Zustand nicht möglich.',
  INVOICE_LOCKED: 'Eine ausgestellte Rechnung kann nicht bearbeitet werden. Erstellen Sie zur Korrektur eine Stornorechnung.',
  CUSTOMER_CODE_TAKEN: 'Diese Kundennummer ist bereits vergeben.',
  CUSTOMER_NOT_FOUND: 'Kein Kunde mit diesem Code gefunden.',
  SELLER_INCOMPLETE: 'Ihre Rechnungsstellerdaten (Steuerangaben) sind unvollständig.',
  TAX_INCOMPLETE: 'Die Steuerangaben der Rechnung sind unvollständig.',
  NOT_STRUCTURED_EINVOICE: 'Die Datei ist keine strukturierte E-Rechnung.',
  INVALID_XML: 'Die XML-Datei ist ungültig.',
  VALIDATOR_NOT_CONFIGURED: 'Die offizielle Validierung ist nicht eingerichtet.',
  DUPLICATE_INVOICE: 'Diese Rechnung wurde wahrscheinlich bereits empfangen.',
  PDF_FAILED: 'PDF konnte nicht erzeugt werden; die reservierte Nummer wird nicht erneut verwendet.',
  RATE_LIMITED: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
  PAYLOAD_TOO_LARGE: 'Die Datei ist zu groß.',
  UNSUPPORTED_MEDIA: 'Dieser Dateityp wird nicht unterstützt.',
  INTERNAL: 'Ein interner Fehler ist aufgetreten.',
};

const MESSAGES_EN: Record<ErrorCode, string> = {
  SETUP_REQUIRED: 'Initial setup has not been completed yet.',
  UNAUTHORIZED: 'Access denied. Please sign in.',
  FORBIDDEN: 'You are not allowed to perform this action.',
  NOT_FOUND: 'The requested item was not found.',
  VALIDATION_ERROR: 'The submitted data is invalid.',
  CONFLICT: 'This action is not possible in the current state.',
  INVOICE_LOCKED: 'An issued invoice cannot be edited. Create a cancellation invoice (Storno) to correct it.',
  CUSTOMER_CODE_TAKEN: 'This customer number is already in use.',
  CUSTOMER_NOT_FOUND: 'No customer found with this code.',
  SELLER_INCOMPLETE: 'Your seller tax details are incomplete.',
  TAX_INCOMPLETE: 'The invoice tax details are incomplete.',
  NOT_STRUCTURED_EINVOICE: 'The file is not a structured e-invoice.',
  INVALID_XML: 'The XML file is invalid.',
  VALIDATOR_NOT_CONFIGURED: 'Official validation is not configured.',
  DUPLICATE_INVOICE: 'This invoice was probably already received.',
  PDF_FAILED: 'PDF generation failed; the reserved number will not be reused.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  PAYLOAD_TOO_LARGE: 'The file is too large.',
  UNSUPPORTED_MEDIA: 'This file type is not supported.',
  INTERNAL: 'An internal error occurred.',
};

const MESSAGES: Record<UiLang, Record<ErrorCode, string>> = { fa: USER_MESSAGES, de: MESSAGES_DE, en: MESSAGES_EN };

/** Pick the UI language from the X-UI-Lang header, then Accept-Language. */
export function resolveUiLang(header?: string | null, acceptLanguage?: string | null): UiLang {
  const pick = (v?: string | null): UiLang | null => {
    const l = (v ?? '').trim().slice(0, 2).toLowerCase();
    return l === 'fa' || l === 'de' || l === 'en' ? l : null;
  };
  return pick(header) ?? pick(acceptLanguage?.split(',')[0]) ?? 'fa';
}

export function messageFor(code: ErrorCode, lang: UiLang): string {
  return MESSAGES[lang][code];
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  SETUP_REQUIRED: 423,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INVOICE_LOCKED: 409,
  CUSTOMER_CODE_TAKEN: 409,
  CUSTOMER_NOT_FOUND: 404,
  SELLER_INCOMPLETE: 422,
  TAX_INCOMPLETE: 422,
  NOT_STRUCTURED_EINVOICE: 422,
  INVALID_XML: 422,
  VALIDATOR_NOT_CONFIGURED: 409,
  DUPLICATE_INVOICE: 409,
  PDF_FAILED: 502,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Technical detail — only surfaced in the Admin Debug view, never to users. */
  readonly detail?: string;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, detail?: string, fields?: Record<string, string>) {
    super(detail ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (detail !== undefined) this.detail = detail;
    if (fields !== undefined) this.fields = fields;
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }
}
