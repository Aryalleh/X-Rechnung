/**
 * PDF generation via Cloudflare Browser Rendering (Browser Run).
 *
 * Uses @cloudflare/puppeteer against the BROWSER binding. The HTML is fully
 * self-contained (no external fonts/assets), so the resulting PDF is text-based
 * and searchable. We deliberately do NOT claim PDF/A conformance.
 */
import type { Env } from '../../config/env';

/** Overridable in tests via setPdfGenerator(). */
let generator: (env: Env, html: string) => Promise<Uint8Array> = defaultGenerator;

export function setPdfGenerator(fn: (env: Env, html: string) => Promise<Uint8Array>): void {
  generator = fn;
}

export function generatePdf(env: Env, html: string): Promise<Uint8Array> {
  return generator(env, html);
}

async function defaultGenerator(env: Env, html: string): Promise<Uint8Array> {
  // Lazy import so unit tests that mock the generator don't need the browser.
  const puppeteer = await import('@cloudflare/puppeteer');
  const browser = await puppeteer.launch(env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
