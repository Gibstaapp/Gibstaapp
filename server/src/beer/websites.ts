import type { BeerPrice, BeerVenue, HappyHour } from '@gib/shared';
import { extractEuroHappyHour, extractHappyHour, htmlToText, parseEuroPrices, parsePrices } from './extract.ts';
import { MAX_PDF_BYTES, OcrSession, pdfLinks, pdfToText } from './pdf.ts';

/**
 * Light crawl of bar/brewery websites: the homepage plus up to 3 likely pages
 * (happy hour / specials / menu / drinks). Plain HTTP, no browser, a few at a time.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const LINK_HINT = /happy|special|deal|drink|beer|tap|menu|bar|κατ[αά]λογ|μεν[οού]|ποτ[αά]|μπ[υύ]ρ|τιμοκατ[αά]λογ/iu;
// untappd: we don't read it automatically (terms of use); its prices only come in by hand via beer-seed.json.
const SKIP_HOST = /facebook|instagram|yelp|google|tripadvisor|doordash|ubereats|grubhub|toasttab\.com\/order|opentable|untappd/i;

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('html')) return null;
    const text = await res.text();
    return text.length > 3_000_000 ? text.slice(0, 3_000_000) : text;
  } catch {
    return null;
  }
}

/** A PDF file, or null if it isn't one / is too big / fails twice (slow sites get one retry). */
async function getPdf(url: string, attempt = 1): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf' }, redirect: 'follow', signal: AbortSignal.timeout(45_000) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length <= MAX_PDF_BYTES && String.fromCharCode(...buf.slice(0, 5)) === '%PDF-' ? buf : null;
  } catch {
    return attempt < 2 ? getPdf(url, attempt + 1) : null;
  }
}

function candidateLinks(html: string, base: string): string[] {
  const out: { url: string; score: number }[] = [];
  const host = new URL(base).host.replace(/^www\./, '');
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ');
    const href = m[1];
    if (!LINK_HINT.test(href + ' ' + label) || /\.(pdf|jpg|png)$/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.host.replace(/^www\./, '') !== host) continue;
    const score = /happy/i.test(href + label) ? 3 : /special|deal|menu|drink|κατ[αά]λογ|μεν[οού]|ποτ[αά]/iu.test(href + label) ? 2 : 1;
    if (!out.some((o) => o.url === url.href)) out.push({ url: url.href, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((o) => o.url);
}

export interface CrawlResult { prices: BeerPrice[]; happyHours: HappyHour[]; sitesTried: number; sitesWithInfo: number; /** venues whose website loaded, or that we don't read (their old website prices should go) */ readIds: string[] }

/**
 * currency 'USD' (San Diego): "$5 drafts" style, English.
 * currency 'EUR' (Athens): "Mythos 500ml 4,50€" style, Greek or English; every price is stored in euros.
 */
export interface CrawlOptions {
  /** Read PDF menus linked from the site (text inside the PDF). Default on. */
  pdfs?: boolean;
  /** OCR budget for PDFs that are only pictures (pages per run; 0 = no OCR). Default 30. */
  ocrPages?: number;
}

export async function crawlVenueSites(venues: BeerVenue[], log: (m: string) => void = () => {}, concurrency = 8, currency: 'USD' | 'EUR' = 'USD', opts: CrawlOptions = {}): Promise<CrawlResult> {
  const eur = currency === 'EUR';
  const readPdfs = opts.pdfs ?? true;
  const ocr = readPdfs && (opts.ocrPages ?? 30) > 0 ? new OcrSession(eur ? 'eng+ell' : 'eng', opts.ocrPages ?? 30) : null;
  let pdfsRead = 0, pdfsOcr = 0;
  const hhOf = eur ? extractEuroHappyHour : extractHappyHour;
  const menuPrices = (text: string) => (eur ? parseEuroPrices(text, false) : parsePrices(text, false));
  const tag = eur ? { currency: 'EUR' as const } : {};
  const targets = venues.filter((v) => v.website && v.kind !== 'store' && !SKIP_HOST.test(v.website));
  const prices: BeerPrice[] = [];
  const happyHours: HappyHour[] = [];
  let withInfo = 0;
  // Sites we skip on purpose count as read (nothing found), so stale prices from them are cleared.
  const readIds: string[] = venues.filter((v) => v.website && !targets.includes(v)).map((v) => v.id);
  const now = new Date().toISOString();
  let i = 0;

  async function worker() {
    while (i < targets.length) {
      const v = targets[i++];
      const home = await get(v.website!);
      if (!home) continue;
      const pages: [string, string][] = [[v.website!, home]];
      for (const url of candidateLinks(home, v.website!)) {
        const html = await get(url);
        if (html) pages.push([url, html]);
      }
      // Web pages, plus PDF menus linked from them (text, or OCR when the PDF is only pictures).
      const docs: { url: string; text: string; menu: boolean; menuDate?: string }[] = pages.map(([url, html]) => {
        const text = htmlToText(html);
        return { url, text, menu: /menu|drink|beer|tap|κατ[αά]λογ|μεν[οού]|ποτ[αά]|μπ[υύ]ρ/iu.test(decodeURI(url)) || /\bon tap\b|draft list|beer list|κατάλογος|μπύρες|βαρέλι/iu.test(text) };
      });
      // A menu PDF that fails to download today: keep this place's previous prices rather than wiping them.
      let pdfFailed = false;
      if (readPdfs) {
        for (const url of [...new Set(pages.flatMap(([u, h]) => pdfLinks(h, u)))].slice(0, 3)) {
          const buf = await getPdf(url);
          if (!buf) { pdfFailed = true; continue; }
          const t = await pdfToText(buf, ocr).catch(() => null);
          if (!t?.text.trim()) continue;
          pdfsRead++;
          if (t.ocr) pdfsOcr++;
          docs.push({ url, text: t.text, menu: true, menuDate: t.menuDate });
        }
      }
      if (!pdfFailed) readIds.push(v.id);
      let found = false;
      const seen = new Set<string>();
      for (const { url, text, menu, menuDate } of docs) {
        const dated = menuDate ? { menuDate } : {};
        const { windows, prices: hhPrices } = hhOf(text);
        for (const w of windows) {
          const key = `${w.days.join()}|${w.start}|${w.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          happyHours.push({ venueId: v.id, days: w.days, start: w.start, end: w.end, text: w.text.slice(0, 280), source: 'website', sourceUrl: url });
          found = true;
        }
        const window = windows[0];
        for (const p of hhPrices) {
          const id = `web:${v.id}:hh:${p.item}:${p.price}`;
          if (prices.some((x) => x.id === id)) continue;
          prices.push({
            id, venueId: v.id, item: p.item, price: p.price, ...tag, size: p.size, kind: 'happy_hour',
            days: window?.days, start: window?.start, end: window?.end,
            source: 'website', sourceUrl: url, snippet: p.text.slice(0, 200), reportedAt: now, ...dated,
          });
          found = true;
        }
        // Regular beer prices on drink menus (only on pages that look like menus, to avoid noise).
        if (menu) {
          for (const p of menuPrices(text).slice(0, 10)) {
            const id = `web:${v.id}:reg:${p.item}:${p.price}`;
            if (prices.some((x) => x.id === id || (x.venueId === v.id && x.price === p.price && x.item === p.item))) continue;
            prices.push({ id, venueId: v.id, item: p.item, price: p.price, ...tag, size: p.size, kind: 'regular', source: 'website', sourceUrl: url, snippet: p.text.slice(0, 200), reportedAt: now, ...dated });
            found = true;
          }
        }
      }
      if (found) withInfo++;
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await ocr?.close();
  }
  log(`checked ${targets.length} websites (${pdfsRead} PDF menus, ${pdfsOcr} read with OCR), found info on ${withInfo}: ${happyHours.length} happy hours, ${prices.length} prices`);
  return { prices, happyHours, sitesTried: targets.length, sitesWithInfo: withInfo, readIds };
}
