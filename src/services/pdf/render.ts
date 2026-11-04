/** Renders an invoice document. Language (de/en/fa) is carried in TemplateData. */
import { renderInvoiceHtml, type TemplateData } from './template';

export function renderInvoiceDocument(d: TemplateData): string {
  return renderInvoiceHtml(d);
}

export type { TemplateData };
