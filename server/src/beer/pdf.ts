import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * PDF menus: the text inside the PDF, rebuilt as visual rows (so a price stays on the line of its beer),
 * or, for PDFs that are only pictures, OCR of the first pages (Greek + English for Athens, English for San Diego).
 * Server-only. Libraries load lazily, so if one is missing the crawl just skips PDFs instead of failing.
 */

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_PAGES = 12;
const MAX_OCR_PAGES_PER_PDF = 3;

export interface PdfText { text: string; ocr: boolean; menuDate?: string; pages: number }

/** An OCR budget shared by one crawl, so a run never spends more than `pages` pages on OCR. */
export class OcrSession {
  private worker: any = null;
  private langs: string;
  pagesLeft: number;
  constructor(langs: 'eng' | 'eng+ell', pages = 30) { this.langs = langs; this.pagesLeft = pages; }
  async recognize(png: Buffer): Promise<string> {
    if (!this.worker) {
      const { createWorker } = (await import('tesseract.js')).default ?? (await import('tesseract.js'));
      this.worker = await createWorker(this.langs.split('+'), 1, { cachePath: join(tmpdir(), 'gibstaapp-tessdata'), logger: () => {} });
    }
    const { data } = await this.worker.recognize(png);
    return data.text as string;
  }
  async close() { await this.worker?.terminate().catch(() => {}); this.worker = null; }
}

/** "D:20250512125523+03'00'" -> "2025-05". */
export function pdfDate(raw: unknown): string | undefined {
  const m = /^D?:?(\d{4})(\d{2})/.exec(String(raw ?? ''));
  return m && +m[1] > 2000 && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : undefined;
}

/** Menus older than this aren't read (a 2021 menu's prices are history, not deals). */
export const MAX_MENU_AGE_MONTHS = 24;
export function tooOld(menuDate: string | undefined, now = new Date()): boolean {
  if (!menuDate) return false;
  const [y, m] = menuDate.split('-').map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) > MAX_MENU_AGE_MONTHS;
}

export async function pdfToText(data: Uint8Array, ocr: OcrSession | null): Promise<PdfText | null> {
  let pdfjs: any;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch { return null; }
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const info = (await doc.getMetadata().catch(() => null))?.info ?? {};
  const menuDate = pdfDate(info.ModDate) ?? pdfDate(info.CreationDate);
  if (tooOld(menuDate)) return { text: '', ocr: false, menuDate, pages: doc.numPages };
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_TEXT_PAGES); i++) {
    const page = await doc.getPage(i);
    const items = (await page.getTextContent()).items.filter((it: any) => it.str?.trim());
    const rows: { y: number; cells: { x: number; s: string }[] }[] = [];
    for (const it of items) {
      const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 8;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.5);
      if (!row) rows.push((row = { y, cells: [] }));
      row.cells.push({ x, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => r.cells.sort((a, b) => a.x - b.x).map((c) => c.s).join('  ')).join('\n'));
  }
  const textChars = pages.join('').replace(/\s/g, '').length;
  if (textChars >= 80 * Math.max(1, pages.length) || !ocr || ocr.pagesLeft <= 0) {
    return { text: pages.join('\n\n'), ocr: false, menuDate, pages: doc.numPages };
  }

  // Pictures only: render the first pages and read them with OCR.
  let createCanvas: any;
  try { ({ createCanvas } = await import('@napi-rs/canvas')); } catch { return { text: pages.join('\n\n'), ocr: false, menuDate, pages: doc.numPages }; }
  const ocrText: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_OCR_PAGES_PER_PDF) && ocr.pagesLeft > 0; i++) {
    ocr.pagesLeft--;
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ocrText.push(await ocr.recognize(canvas.toBuffer('image/png')));
  }
  return { text: ocrText.join('\n\n'), ocr: true, menuDate, pages: doc.numPages };
}

/** PDF links on a page worth reading: menus first; grant posters and hygiene notices never. */
export function pdfLinks(html: string, base: string): string[] {
  const host = new URL(base).host.replace(/^www\./, '');
  const out: { url: string; score: number }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(m[1], base); } catch { continue; }
    if (url.host.replace(/^www\./, '') !== host) continue;
    const name = `${decodeURIComponent(url.pathname)} ${m[2].replace(/<[^>]+>/g, ' ')}`;
    if (/espa|εσπα|epanek|επανεκ|health|hygiene|υγειον|ταμπέλα|privacy|terms|cv\b|allergen/iu.test(name)) continue;
    // Press clippings and articles about the bar aren't its menu (a newspaper's "happy hour" may be anyone's).
    if (/press|news|article|sdut|times|magazine|review|award|media|άρθρο|δημοσίευ/iu.test(name)) continue;
    // Beer/drinks menus first. Wine lists aren't skipped ("wines & spirits" menus often list the beers too);
    // wine lines themselves are rejected when prices are read.
    const score = /beer|μπ[υύ]ρ|drink|ποτ[αά]|bar\b|cocktail|happy/iu.test(name) ? 3 : /menu|μεν[οού]|κατ[αά]λογ|catalog|spirits/iu.test(name) ? 2 : 1;
    if (score < 2 && !/happy|special|deal/iu.test(name)) continue; // only PDFs that say they're a menu
    if (!out.some((o) => o.url === url.href)) out.push({ url: url.href, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((o) => o.url);
}
