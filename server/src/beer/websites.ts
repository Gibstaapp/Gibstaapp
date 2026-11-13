import type { BeerPrice, BeerVenue, HappyHour } from '@gib/shared';
import { extractHappyHour, htmlToText, parsePrices } from './extract.ts';

/**
 * Light crawl of bar/brewery websites: the homepage plus up to 3 likely pages
 * (happy hour / specials / menu / drinks). Plain HTTP, no browser, a few at a time.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const LINK_HINT = /happy|special|deal|drink|beer|tap|menu|bar/i;
const SKIP_HOST = /facebook|instagram|yelp|google|tripadvisor|doordash|ubereats|grubhub|toasttab\.com\/order|opentable/i;

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
    const score = /happy/i.test(href + label) ? 3 : /special|deal/i.test(href + label) ? 2 : 1;
    if (!out.some((o) => o.url === url.href)) out.push({ url: url.href, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((o) => o.url);
}

export interface CrawlResult { prices: BeerPrice[]; happyHours: HappyHour[]; sitesTried: number; sitesWithInfo: number }

export async function crawlVenueSites(venues: BeerVenue[], log: (m: string) => void = () => {}, concurrency = 8): Promise<CrawlResult> {
  const targets = venues.filter((v) => v.website && v.kind !== 'store' && !SKIP_HOST.test(v.website));
  const prices: BeerPrice[] = [];
  const happyHours: HappyHour[] = [];
  let withInfo = 0;
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
      let found = false;
      const seen = new Set<string>();
      for (const [url, html] of pages) {
        const text = htmlToText(html);
        const { windows, prices: hhPrices } = extractHappyHour(text);
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
            id, venueId: v.id, item: p.item, price: p.price, size: p.size, kind: 'happy_hour',
            days: window?.days, start: window?.start, end: window?.end,
            source: 'website', sourceUrl: url, snippet: p.text.slice(0, 200), reportedAt: now,
          });
          found = true;
        }
        // Regular beer prices on drink menus (only on pages that look like menus, to avoid noise).
        if (/menu|drink|beer|tap/i.test(url) || /\bon tap\b|draft list|beer list/i.test(text)) {
          for (const p of parsePrices(text, false).slice(0, 10)) {
            const id = `web:${v.id}:reg:${p.item}:${p.price}`;
            if (prices.some((x) => x.id === id || (x.venueId === v.id && x.price === p.price && x.item === p.item))) continue;
            prices.push({ id, venueId: v.id, item: p.item, price: p.price, size: p.size, kind: 'regular', source: 'website', sourceUrl: url, snippet: p.text.slice(0, 200), reportedAt: now });
            found = true;
          }
        }
      }
      if (found) withInfo++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`checked ${targets.length} websites, found info on ${withInfo}: ${happyHours.length} happy hours, ${prices.length} prices`);
  return { prices, happyHours, sitesTried: targets.length, sitesWithInfo: withInfo };
}
