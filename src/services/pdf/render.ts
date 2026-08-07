/** Picks the invoice template by output language (de → German, fa → Persian). */
import { renderInvoiceHtml, type TemplateData } from './template';
import { renderInvoiceHtmlFa } from './template-fa';

export function renderInvoiceDocument(d: TemplateData): string {
  return d.language === 'fa' ? renderInvoiceHtmlFa(d) : renderInvoiceHtml(d);
}
