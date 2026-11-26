import type { BeerPrice, BeerVenue, HappyHour } from '@gib/shared';
import { extractEuroHappyHour, extractHappyHour, htmlToText, parseEuroPrices, parseMenuSections, parsePrices, type FoundFood } from './extract.ts';
import { MAX_PDF_BYTES, OcrSession, pdfLinks, pdfToText } from './pdf.ts';

/**
 * Crawl of bar / brewery / restaurant websites: the homepage plus every page of the site's own menu bar
 * (up to MAX_PAGES, happy hour / specials / menu pages first). Plain HTTP; sites that build their pages with
 * JavaScript (GoDaddy, Wix...) and come back nearly empty are opened in a real browser instead, within a budget.
 */
const MAX_PAGES = 10;
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

/** Pages that never hold prices. */
const SKIP_PAGE = /privacy|terms|cookie|career|jobs|employ|login|sign-?in|account|cart|checkout|gift|wp-(?:admin|json|content)|\/feed|\/tag\/|\/category\/|\/author\/|\/blog\/.|\/news\/.|press|reserv|booking|\/book\b|donat|accessib|sitemap|\/shop\/|\/product\/|careers/i;

/** Every page of the site's own menu bar, best first: happy hour, specials / deals, menus, then the rest ("every tab"). */
export function siteLinks(html: string, base: string, max = MAX_PAGES - 1): string[] {
  const out: { url: string; score: number }[] = [];
  const host = new URL(base).host.replace(/^www\./, '');
  const baseUrl = new URL(base);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ');
    const href = m[1];
    if (/^(?:tel|mailto|javascript|sms):/i.test(href) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|ics|mp4|mov)(?:\?|$)/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    url.hash = '';
    if (url.host.replace(/^www\./, '') !== host || url.pathname === baseUrl.pathname && url.search === baseUrl.search) continue;
    if (SKIP_PAGE.test(url.pathname) || url.pathname.split('/').filter(Boolean).length > 3) continue;
    const both = `${decodeURIComponent(url.pathname)} ${label}`;
    const score = /happy/i.test(both) ? 5 : /special|deal|promo|daily|weekly/i.test(both) ? 4 : LINK_HINT.test(both) || /food|eat|lunch|dinner|brunch|kitchen/i.test(both) ? 3 : 1;
    if (!out.some((o) => o.url === url.href)) out.push({ url: url.href, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map((o) => o.url);
}

/** A page that came back nearly empty although the HTML is big: it's built by JavaScript in the browser. */
export const builtByScript = (html: string, text: string) => text.replace(/\s+/g, ' ').length < 1500 && html.length > 20_000;

/**
 * Opens JavaScript-built sites in a real browser (Playwright), scrolls so lazy sections load, and returns the page's
 * text and links. One browser for the whole crawl; `budget` pages at most. Never throws: no browser = no rendering.
 */
class Renderer {
  private ctx: Promise<{ ctx: any; close: () => Promise<void> } | null> | null = null;
  private active = 0;
  constructor(public budget: number) {}
  private open() {
    return (this.ctx ??= (async () => {
      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
        return { ctx, close: async () => { await browser.close().catch(() => {}); } };
      } catch { return null; }
    })());
  }
  async render(url: string): Promise<{ html: string; text: string } | null> {
    if (this.budget <= 0) return null;
    this.budget--;
    const r = await this.open();
    if (!r) return null;
    while (this.active >= 3) await new Promise((res) => setTimeout(res, 200));
    this.active++;
    const page = await r.ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      // Lazy sections (menus in galleries, "load more") only appear when scrolled into view.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
      }).catch(() => {});
      await page.waitForTimeout(800);
      const [html, text] = await Promise.all([page.content(), page.evaluate(() => document.body.innerText)]);
      return { html, text };
    } catch { return null; } finally {
      this.active--;
      await page.close().catch(() => {});
    }
  }
  async close() { const r = await this.ctx; await r?.close(); }
}

export interface CrawlResult { prices: BeerPrice[]; happyHours: HappyHour[]; sitesTried: number; sitesWithInfo: number; /** venues whose website loaded, or that we don't read (their old website prices should go) */ readIds: string[]; /** places whose own homepage says they've closed for good */ closedIds: string[] }

/** A homepage saying the place has closed for good. */
export const CLOSED_FOR_GOOD = /\b(?:permanently closed|closed permanently|(?:we|we've|we have|has|have) (?:officially |now )?closed (?:our|its|the) doors|closed for good|(?:is|are) now (?:permanently )?closed for business|thank you for (?:\d+|many|all the) (?:amazing |wonderful |great )?years)\b/i;

/**
 * currency 'USD' (San Diego): "$5 drafts" style, English.
 * currency 'EUR' (Athens): "Mythos 500ml 4,50€" style, Greek or English; every price is stored in euros.
 */
export interface CrawlOptions {
  /** Read PDF menus linked from the site (text inside the PDF). Default on. */
  pdfs?: boolean;
  /** OCR budget for PDFs that are only pictures (pages per run; 0 = no OCR). Default 30. */
  ocrPages?: number;
  /** Pages of JavaScript-built sites to open in a real browser per run (0 = never). Default 150. */
  renderPages?: number;
}

export async function crawlVenueSites(venues: BeerVenue[], log: (m: string) => void = () => {}, concurrency = 8, currency: 'USD' | 'EUR' = 'USD', opts: CrawlOptions = {}): Promise<CrawlResult> {
  const eur = currency === 'EUR';
  const readPdfs = opts.pdfs ?? true;
  const ocr = readPdfs && (opts.ocrPages ?? 30) > 0 ? new OcrSession(eur ? 'eng+ell' : 'eng', opts.ocrPages ?? 30) : null;
  const renderer = new Renderer(opts.renderPages ?? 150);
  let pdfsRead = 0, pdfsOcr = 0, rendered = 0, pagesRead = 0, foodFound = 0;
  const hhOf = eur ? extractEuroHappyHour : extractHappyHour;
  const menuPrices = (text: string) => (eur ? parseEuroPrices(text, false) : parsePrices(text, false));
  const tag = eur ? { currency: 'EUR' as const } : {};
  const targets = venues.filter((v) => v.website && v.kind !== 'store' && !SKIP_HOST.test(v.website));
  const prices: BeerPrice[] = [];
  const happyHours: HappyHour[] = [];
  let withInfo = 0;
  // Sites we skip on purpose count as read (nothing found), so stale prices from them are cleared.
  const readIds: string[] = venues.filter((v) => v.website && !targets.includes(v)).map((v) => v.id);
  const closedIds: string[] = [];
  const now = new Date().toISOString();
  let i = 0;

  async function worker() {
    while (i < targets.length) {
      const v = targets[i++];
      let home = await get(v.website!);
      // Sites built in the browser by JavaScript (GoDaddy, Wix...): open the homepage in a real browser.
      let renderedHome: { html: string; text: string } | null = null;
      if (home && builtByScript(home, htmlToText(home))) renderedHome = await renderer.render(v.website!);
      else if (!home) { renderedHome = await renderer.render(v.website!); }
      if (renderedHome) { rendered++; home = renderedHome.html; }
      if (!home) continue;
      // Closed for good, says their own homepage: the place goes.
      if (CLOSED_FOR_GOOD.test((renderedHome?.text ?? htmlToText(home)).slice(0, 4000))) { closedIds.push(v.id); continue; }
      const pages: [string, string, string?][] = [[v.website!, home, renderedHome?.text]];
      // Every tab of the site's menu bar.
      for (const url of siteLinks(home, v.website!)) {
        let html = await get(url);
        let text: string | undefined;
        if (renderedHome && (!html || builtByScript(html, htmlToText(html)))) {
          const r = await renderer.render(url);
          if (r) { rendered++; html = r.html; text = r.text; }
        }
        if (html) pages.push([url, html, text]);
      }
      pagesRead += pages.length;
      // Web pages, plus PDF menus linked from them (text, or OCR when the PDF is only pictures).
      const docs: { url: string; text: string; menu: boolean; menuDate?: string }[] = pages.map(([url, html, renderedText]) => {
        const text = renderedText ?? htmlToText(html);
        return { url, text, menu: /menu|drink|beer|tap|κατ[αά]λογ|μεν[οού]|ποτ[αά]|μπ[υύ]ρ/iu.test(decodeURI(url)) || /\bon tap\b|draft list|beer list|craft beer|κατάλογος|μπύρες|βαρέλι/iu.test(text) };
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
      let foodHere = 0;
      // Food prices and deals from the same pages (at most 15 per place).
      const addFood = (f: FoundFood, url: string, dated: { menuDate?: string }, w?: { days: number[]; start: string; end: string }) => {
        if (foodHere >= 15) return;
        const id = `web:${v.id}:food:${f.item}:${f.price}`;
        if (prices.some((x) => x.id === id)) return;
        prices.push({
          id, venueId: v.id, item: f.item, price: f.price, category: 'food', kind: f.happyHour ? 'happy_hour' : 'regular',
          ...(f.withBeer ? { withBeer: true } : {}), ...(f.addOn ? { addOn: true } : {}),
          ...(f.happyHour && w ? { days: w.days, start: w.start, end: w.end } : {}),
          source: 'website', sourceUrl: url, snippet: f.text.slice(0, 200), reportedAt: now, ...dated,
        });
        foodHere++; foodFound++;
        found = true;
      };
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
        // Food from the happy-hour text ("$1 wings 4-6pm").
        for (const f of (eur ? [] : (hhOf(text) as { food?: FoundFood[] }).food ?? [])) addFood(f, url, dated, window);
        // Menus laid out in sections: beers under a beer heading, food under food headings ("Burgers", "Hot Dogs").
        if (!eur) {
          const sec = parseMenuSections(text);
          for (const p of sec.beer) {
            const id = `web:${v.id}:${p.happyHour ? 'hh' : 'reg'}:${p.item}:${p.price}`;
            if (prices.some((x) => x.id === id || (x.venueId === v.id && x.category !== 'food' && x.price === p.price && x.item.toLowerCase() === p.item.toLowerCase()))) continue;
            prices.push({ id, venueId: v.id, item: p.item, price: p.price, size: p.size, kind: p.happyHour ? 'happy_hour' : 'regular', ...(p.happyHour && window ? { days: window.days, start: window.start, end: window.end } : {}), source: 'website', sourceUrl: url, snippet: p.text.slice(0, 200), reportedAt: now, ...dated });
            found = true;
          }
          for (const f of sec.food) addFood(f, url, dated, f.happyHour ? window : undefined);
        }
        // Regular beer prices on drink menus (only on pages that look like menus, to avoid noise).
        if (menu) {
          for (const p of menuPrices(text).slice(0, 10)) {
            const id = `web:${v.id}:reg:${p.item}:${p.price}`;
            const lc = p.item.toLowerCase();
            if (prices.some((x) => x.id === id || (x.venueId === v.id && x.category !== 'food' && x.price === p.price && (x.item.toLowerCase().endsWith(lc) || lc.endsWith(x.item.toLowerCase()))))) continue;
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
    await renderer.close();
  }
  const beerCount = prices.filter((p) => p.category !== 'food').length;
  log(`checked ${targets.length} websites (${pagesRead} pages, ${rendered} opened in a browser, ${pdfsRead} PDF menus, ${pdfsOcr} read with OCR), found info on ${withInfo}: ${happyHours.length} happy hours, ${beerCount} beer prices, ${foodFound} food prices`);
  if (closedIds.length) log(`${closedIds.length} places say on their website that they've closed for good`);
  return { prices, happyHours, sitesTried: targets.length, sitesWithInfo: withInfo, readIds, closedIds };
}
