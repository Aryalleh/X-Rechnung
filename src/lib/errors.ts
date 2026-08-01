/** Typed application errors with Persian user-facing messages. */

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
