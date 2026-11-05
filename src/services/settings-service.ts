/** Typed access to settings across the app. Nothing here is hardcoded — every
 * value is read from D1 with a documented default fallback. */
import { getGroup, getSetting, setSetting } from '../db/repositories/settings-repo';
import type { SettingGroup } from '../db/repositories/settings-repo';
import { getIntegration } from '../db/repositories/cloudflare-repo';
import { DEFAULTS } from '../config/constants';

export interface AccessConfig {
  aud: string | null;
  teamDomain: string | null;
}

export async function getAccessConfig(db: D1Database): Promise<AccessConfig> {
  const cf = await getIntegration(db);
  return { aud: cf?.access_aud ?? null, teamDomain: cf?.access_team_domain ?? null };
}

export interface GeneralSettings {
  app_name: string;
  base_url: string | null;
  locale: string;
  invoice_language: string;
  timezone: string;
  date_format: string;
  currency: string;
  country: string;
  theme: 'light' | 'dark' | 'auto';
  /** Installation profile: 'fa' (Iran only), 'de' (Germany only), 'both'. */
  invoice_mode: 'fa' | 'de' | 'both';
}

export async function getGeneralSettings(db: D1Database): Promise<GeneralSettings> {
  const g = await getGroup(db, 'GENERAL');
  const l = await getGroup(db, 'LOCALIZATION');
  const mode = (l.invoice_mode as GeneralSettings['invoice_mode']) ?? 'both';
  // Sensible language/currency defaults follow the chosen profile unless
  // explicitly overridden in settings.
  const defaultLang = mode === 'fa' ? 'fa' : mode === 'de' ? 'de' : DEFAULTS.invoiceLanguage;
  const defaultCur = mode === 'fa' ? 'IRT' : DEFAULTS.currency;
  return {
    app_name: (g.app_name as string) ?? 'X-Rechnung',
    base_url: (g.base_url as string) ?? null,
    locale: (l.locale as string) ?? DEFAULTS.locale,
    invoice_language: (l.invoice_language as string) ?? defaultLang,
    timezone: (l.timezone as string) ?? DEFAULTS.timezone,
    date_format: (l.date_format as string) ?? DEFAULTS.dateFormat,
    currency: (l.currency as string) ?? defaultCur,
    country: (l.country as string) ?? DEFAULTS.country,
    theme: (g.theme as GeneralSettings['theme']) ?? 'auto',
    invoice_mode: mode,
  };
}

export interface InvoiceSettings {
  prefix_rechnung: string;
  prefix_storno: string;
  prefix_gutschrift: string;
  number_digits: number;
  payment_days: number;
  payment_terms_text: string | null;
  thanks_text: string | null;
  rights_text: string | null;
  show_logo: boolean;
  show_bank: boolean;
  filename_pattern: string;
  invoice_language: string;
  tax_exemption_text: string;
  accent_color: string;
  brand_heading: string | null;
  /** Optional uploaded invoice font (data URLs); overrides Vazirmatn for Persian. */
  custom_font: { family?: string; regularDataUrl?: string; boldDataUrl?: string } | null;
}

export async function getInvoiceSettings(db: D1Database): Promise<InvoiceSettings> {
  const s = await getGroup(db, 'INVOICE');
  return {
    prefix_rechnung: (s.prefix_rechnung as string) ?? DEFAULTS.prefixRechnung,
    prefix_storno: (s.prefix_storno as string) ?? DEFAULTS.prefixStorno,
    prefix_gutschrift: (s.prefix_gutschrift as string) ?? DEFAULTS.prefixGutschrift,
    number_digits: (s.number_digits as number) ?? DEFAULTS.numberDigits,
    payment_days: (s.payment_days as number) ?? DEFAULTS.paymentDays,
    payment_terms_text: (s.payment_terms_text as string) ?? null,
    thanks_text: (s.thanks_text as string) ?? 'Vielen Dank für die Zusammenarbeit.',
    rights_text: (s.rights_text as string) ?? null,
    show_logo: (s.show_logo as boolean) ?? true,
    show_bank: (s.show_bank as boolean) ?? true,
    filename_pattern: (s.filename_pattern as string) ?? '{number}_{customer}.pdf',
    invoice_language: (s.invoice_language as string) ?? DEFAULTS.invoiceLanguage,
    tax_exemption_text: (s.tax_exemption_text as string) ?? DEFAULTS.taxExemptionText,
    accent_color: (s.accent_color as string) ?? '#F2EA00',
    brand_heading: (s.brand_heading as string) ?? null,
    custom_font: (s.font_regular_data_url as string)
      ? { family: (s.font_family as string) || 'CustomInvoiceFont', regularDataUrl: s.font_regular_data_url as string, boldDataUrl: (s.font_bold_data_url as string) || (s.font_regular_data_url as string) }
      : null,
  };
}

export interface EInvoiceSettings {
  inbound_enabled: boolean;
  accept_xrechnung: boolean;
  accept_zugferd: boolean;
  accept_pdf_plain: boolean;
  max_file_bytes: number;
  kosit_url: string | null; // stored in settings (non-secret); API key in secret_store
  kosit_timeout_ms: number;
  kosit_retries: number;
  retention_years: number;
}

export async function getEInvoiceSettings(db: D1Database): Promise<EInvoiceSettings> {
  const s = await getGroup(db, 'EINVOICE');
  return {
    inbound_enabled: (s.inbound_enabled as boolean) ?? true,
    accept_xrechnung: (s.accept_xrechnung as boolean) ?? true,
    accept_zugferd: (s.accept_zugferd as boolean) ?? true,
    accept_pdf_plain: (s.accept_pdf_plain as boolean) ?? true,
    max_file_bytes: (s.max_file_bytes as number) ?? 15 * 1024 * 1024,
    kosit_url: (s.kosit_url as string) ?? null,
    kosit_timeout_ms: (s.kosit_timeout_ms as number) ?? 30000,
    kosit_retries: (s.kosit_retries as number) ?? 2,
    retention_years: (s.retention_years as number) ?? DEFAULTS.retentionYears,
  };
}

export { getSetting, setSetting };
export type { SettingGroup };
