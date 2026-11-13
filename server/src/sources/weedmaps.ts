import type { Audience, Category, Deal, DealConditions, DealTarget, DeliveryOption, Product, Store } from '@gib/shared';
import type { Page } from 'playwright';
import type { SearchArea, SourceAdapter, SourceResult } from './types.ts';
import { config } from '../config.ts';
import { withContext, pause } from './browser.ts';
import { mapCategory, parseGrams, parseThcMg } from '../normalize.ts';
import { weeklyHoursToOsm } from '../hours.ts';

/**
 * Weedmaps adapter.
 *
 * Loads weedmaps.com in a real browser (shared Playwright helper), then calls the same JSON APIs the site
 * uses from inside the page (fetch in page context, so origin/cookies match):
 *   - GET api-g.weedmaps.com/discovery/v2/listings?latlng=..&filter[bounding_latlng]=..&filter[bounding_radius]=30mi
 *       &filter[any_retailer_services][]=storefront&filter[any_retailer_services][]=delivery&page_size=100&page=N
 *     -> storefronts + delivery services, sorted by distance (includes online_ordering fee/min/eta, promo_code)
 *   - GET .../discovery/v1/listings/{dispensaries|deliveries}/<slug>          -> website, first-time announcement
 *   - GET .../discovery/v1/listings/{dispensaries|deliveries}/<slug>/menu_items?page=N&page_size=150
 *     -> menu items with price variants; meta.has_taxes_included
 *   - GET .../discovery/v1/deals?latlng=..&filter[bounding_radius]=..&page_size=100&page=N  -> every deal in the area
 */

/** How many menus to fetch (closest first). Storefronts + delivery services. */
export const MAX_STOREFRONT_MENUS = 20;
export const MAX_DELIVERY_MENUS = 8;
const PAGE_SIZE = 150; // API maximum
/**
 * Menus are fetched per category group (Weedmaps' global category UUIDs; gear/wellness skipped), sorted by price.
 * Big SD menus run 2-4k items, so each group has a page cap; when exceeded we take the cheapest and the priciest pages.
 */
const MENU_GROUPS: { name: string; uuids: string[]; maxPages: number }[] = [
  { name: 'flower', uuids: ['a780af3d-bdfe-41ce-a782-20f2519fd7be'], maxPages: 3 },
  { name: 'pre-rolls', uuids: ['b74eb425-04b9-4d44-9890-6d505bed678c', 'af1da756-f390-4a05-8f59-3addb33ed1db'], maxPages: 2 },
  { name: 'vapes', uuids: ['f12d28a5-dc36-41d2-98f8-56d6cf2d8225'], maxPages: 3 },
  { name: 'concentrates', uuids: ['4a284200-870b-466a-bd95-db521d2c5e69'], maxPages: 2 },
  { name: 'edibles', uuids: ['3dce0614-7c15-428f-8c32-fd6802d0b75e', '03d1a014-df0c-446d-9069-aa6f8ba9fe63'], maxPages: 2 },
];
const FALLBACK_PAGES = 6;
/** Shorter gap between consecutive pages of one menu (2 workers => roughly 1-1.5 requests/s overall). */
const MENU_PAGE_PAUSE_MS = 350;
const CONCURRENCY = 2;
const API = 'https://api-g.weedmaps.com';
const START_URL = 'https://weedmaps.com/dispensaries/in/united-states/california/san-diego';

// ======================================================================================
// Deal text parsing (exported for unit tests)
// ======================================================================================

export type ParsedDeal = Omit<Deal, 'id' | 'storeId' | 'source'>;

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10 };
const num = (s: string) => NUM_WORDS[s.toLowerCase()] ?? parseFloat(s);

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\bpre[- ]?rolls?\b|\bprerolls?\b|\bjoints?\b|\bblunts?\b|\bdogwalkers?\b/i, 'preroll'],
  [/\bvapes?\b|\bvape pens?\b|\bcarts?\b|\bcartridges?\b|\bdisposables?\b|\bpods?\b|\baios?\b|\ball[- ]in[- ]ones?\b/i, 'vape'],
  [/\bconcentrates?\b|\bwax\b|\bdabs?\b|\brosin\b|\blive resin\b|\bbadder\b|\bbatter\b|\bshatter\b|\bsauce\b|\bdiamonds\b|\bhash\b|\bextracts?\b/i, 'concentrate'],
  [/\bedibles?\b|\bgumm(y|ies)\b|\bchocolates?\b|\bbeverages?\b|\bdrinks?\b|\bmunchies?\b|\bcandy\b|\bbaked goods\b/i, 'edible'],
  [/\bflower\b|\beighths?\b|\b8ths?\b|\bounces?\b|\bzips?\b|\bbuds?\b|\bsmalls\b|\bshake\b|\bquarters?\b/i, 'flower'],
];

function categoriesIn(s: string): Category[] {
  const out: Category[] = [];
  for (const [re, c] of CATEGORY_WORDS) if (re.test(s) && !out.includes(c)) out.push(c);
  return out;
}

/** Weight a flower deal is restricted to ("eighths" -> 3.5g). */
function weightIn(s: string): number | undefined {
  if (/\beighths?\b|\b8ths?\b|\b1\/8\b/i.test(s)) return 3.5;
  if (/\bquarters?\b|\b1\/4\b/i.test(s)) return 7;
  if (/\bhalf[- ]?(oz|ounce)s?\b|\bhalves\b|\b1\/2 ?oz\b/i.test(s)) return 14;
  if (/\bounces?\b|\bzips?\b|\b28 ?g\b|\b1 ?oz\b/i.test(s)) return 28;
  return undefined;
}

function audienceIn(s: string): Audience | undefined {
  if (/first[- ]?time|\bnew (customer|patient|member|client|guest|shopper)s?\b|\bfirst (purchase|order|visit)\b|\bftp\b|\bnewbies?\b|\bnew to\b/i.test(s)) return 'first_time';
  if (/\bveterans?\b|\bmilitary\b|\bvets?\b/i.test(s)) return 'veteran';
  if (/\bseniors?\b|\b(55|60|62|65)\s*\+/i.test(s)) return 'senior';
  if (/\bstudents?\b/i.test(s)) return 'student';
  return undefined;
}

function daysIn(s: string): number[] | undefined {
  const t = s.toLowerCase();
  const range = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:-|–|to|through|thru)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (range) {
    const a = DAY_NAMES.indexOf(range[1]), b = DAY_NAMES.indexOf(range[2]);
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
    return out;
  }
  if (/\bmon(day)?\s*(-|–|to|thru|through)\s*fri(day)?\b|\bweekdays?\b/.test(t)) return [1, 2, 3, 4, 5];
  const days = new Set<number>();
  DAY_NAMES.forEach((d, i) => { if (new RegExp(`\\b${d}s?\\b`).test(t)) days.add(i); });
  if (/\bweekends?\b/.test(t)) { days.add(0); days.add(6); }
  return days.size && days.size < 7 ? [...days].sort() : undefined;
}

function expiresIn(s: string, now = new Date()): string | undefined {
  const m = s.match(/\b(?:until|thru|through|till|ends?|expires?|valid through)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i)
    ?? s.match(/\b\d{1,2}\/\d{1,2}\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return undefined;
  const mon = parseInt(m[1]) - 1, day = parseInt(m[2]);
  if (mon < 0 || mon > 11 || day < 1 || day > 31) return undefined;
  let year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3])) : now.getFullYear();
  if (!m[3] && mon < now.getMonth() - 1) year++;
  return new Date(year, mon, day, 23, 59, 59).toISOString();
}

function conditionsIn(s: string, audience: Audience): DealConditions {
  const c: DealConditions = {};
  const min = s.match(/\b(?:spend|orders? (?:of|over)|purchases? (?:of|over)|minimum (?:purchase |order )?(?:of )?|min\.? (?:purchase |order )?(?:of )?)\s*\$(\d+(?:\.\d+)?)/i)
    ?? s.match(/\$(\d+(?:\.\d+)?)\s*(?:\+|or more|and up|minimum|min\b)/i);
  if (min) c.minSpend = parseFloat(min[1]);
  if (/in[- ]store only|in[- ]store purchases only|valid in[- ]store only|instore only/i.test(s)) c.inStoreOnly = true;
  if (/pick[- ]?up only|no deliver(y|ies)|not valid (for|on) deliver/i.test(s)) c.pickupOnly = true;
  if (/deliver(y|ies) only|only (for|on) deliver/i.test(s)) c.deliveryOnly = true;
  if (/cash only/i.test(s)) c.cashOnly = true;
  if (/\bvalid (california |ca |state )?id\b|\bshow (your |a )?(valid )?(california |ca )?id\b|\bwith (valid )?id\b|\b(military|student|veteran) id\b/i.test(s) || ['veteran', 'senior', 'student'].includes(audience)) c.idRequired = true;
  const lim = s.match(/\blimit (?:of )?(\d+|one|two|three) per (?:customer|person|patient|transaction|order)/i);
  if (lim) c.limitPerCustomer = num(lim[1]);
  else if (audience === 'first_time') c.limitPerCustomer = 1;
  const exp = expiresIn(s);
  if (exp) c.expiresAt = exp;
  return c;
}

function stackableIn(s: string): boolean | undefined {
  if (/cannot (be )?(combin|stack)|can'?t (be )?(combin|stack)|not (valid|combinable) with|no (stacking|double)|double discounts? (do|does) not apply|may not be combined|not be combined|cannot combine|one discount per|discounts? do not stack/i.test(s)) return false;
  if (/can be combined|stackable|stacks? with/i.test(s)) return true;
  return undefined;
}

/** Phrases that mean "only some items": can't be modeled without a product list. */
const SELECT_RE = /\bselect(ed)?\b|pre[- ]?selected|\bspecific\b|\bmost\b|\bfeatured (brands?|items?|products?)\b|\bspecials?\b|\bfavorite brands\b|\bchoose\b|\bmystery\b|\bup to\s*\d+\s*%|\bhappy hour\b|\bearly bird\b|\blate night\b|\bone brand\b|\bbrand of the\b|\bmix (and|&) match brands\b/i;

const STOP_WORDS = new Set(('all any your entire every everything the our in-stock in stock stock products product items item purchase purchases ' +
  'order orders store storewide sitewide menu today first time first-time customers customer patients patient visit new ' +
  'qualifying regular price priced non-sale off of a an get receive enjoy take save extra additional total cart shop ' +
  'daily day days week weekly online local locals ftp returning deals deal everyday all-day top bulk baggie whole sale sales ' +
  'discount discounts code promo subtotal bill').split(' '));
const PHRASE_BREAK = /\b(?:plus|when|with|for|on|at|if|while|during|until|thru|through|and|or|excludes?|excluding|limit|must|w\/)\b|[,.!:;()|*\-–—+]/i;

function cleanSegment(s: string) {
  return s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** After "N% off" / "$N off": what does it apply to? Returns null if it's a vague "brands"/select target. */
function targetAfter(rest: string): { brands?: string[] } | null {
  let phrase = rest.replace(/^\s*(on\s+)?/i, '');
  const br = phrase.search(PHRASE_BREAK);
  if (br >= 0) phrase = phrase.slice(0, br);
  const words = phrase.split(/\s+/).filter(Boolean).slice(0, 5);
  const left: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[^a-z0-9&'#-]/g, '');
    if (!/[a-z0-9]/.test(lw)) continue;
    if (STOP_WORDS.has(lw)) continue;
    if (DAY_NAMES.some((d) => lw === d || lw === d + 's') || lw === 'weekend' || lw === 'weekends') continue;
    if (categoriesIn(lw).length || /^(8ths?|eighths?|ounces?|oz|grams?|\d+(\.\d+)?g|1\/8|1\/4|1\/2|half|indoor|outdoor|greenhouse|premium|infused|live)$/.test(lw)) continue;
    if (/^brands?$|^vendors?$/.test(lw)) return null;
    if (/^\d/.test(lw)) break;
    left.push(w.replace(/[^\p{L}\p{N}&'#. -]/gu, ''));
  }
  const brand = left.join(' ').trim();
  if (!brand) return {};
  // Long leftover phrases are usually prose, not a brand name.
  if (left.length > 3) return null;
  return { brands: [brand] };
}

interface Offer { kind: Deal['kind']; value?: number; bundleQty?: number; bundlePrice?: number; bogoBuy?: number; bogoGetPct?: number; brands?: string[]; grams?: number }

/** Find one offer in a short piece of text. */
function offerIn(s: string): Offer | null | undefined {
  // BOGO / buy N get 1
  const bogo = s.match(/\bbogo\b|\bbuy\s*(one|1)\s*,?\s*get\s*(one|1)\b|\bb1g1\b/i);
  const bng1 = s.match(/\bb([2-5])g1\b|\bbuy\s*(\d|two|three|four)\s*,?\s*get\s*(?:one|1)\b/i);
  if (bogo || bng1) {
    const buy = bogo ? 1 : num((bng1![1] ?? bng1![2]));
    const after = s.slice((bogo ?? bng1)!.index! + (bogo ?? bng1)![0].length);
    const pct = after.match(/^\D{0,25}?(\d{1,3})\s*%\s*off/i);
    // "BOGO", "BOGO free", "B2G1 for $1/a penny" ~ free; "BOGO 50% off" -> 50.
    const getPct = pct ? Math.min(100, parseInt(pct[1])) : 100;
    return { kind: 'bogo', bogoBuy: buy, bogoGetPct: getPct };
  }
  // N for $X / any N 8ths $X
  const bundle = s.match(/\b(\d+|two|three|four|five|six)\s+(?:[a-z0-9.'#-]+\s+){0,3}?for\s+\$\s?(\d+(?:\.\d+)?)/i)
    ?? s.match(/\bany\s+(\d+|two|three|four|five|six)\s+(?:[a-z0-9.'#-]+\s+){0,3}?\$\s?(\d+(?:\.\d+)?)/i);
  if (bundle && num(bundle[1]) >= 2 && num(bundle[1]) <= 10) {
    return { kind: 'bundle', bundleQty: num(bundle[1]), bundlePrice: parseFloat(bundle[2]), grams: weightIn(s) };
  }
  if (/\bup to\s*\d+\s*%/i.test(s)) return null;
  // N% off
  const pct = s.match(/(\d{1,3})\s*%\s*(?:off|discount)\b/i);
  if (pct) {
    const v = parseInt(pct[1]);
    if (v <= 0 || v > 100) return null;
    const t = targetAfter(s.slice(pct.index! + pct[0].length));
    if (t === null) return null;
    return { kind: 'percent', value: v, ...t };
  }
  // $N off
  const amt = s.match(/\$\s?(\d+(?:\.\d+)?)\s*off\b/i);
  if (amt) {
    const t = targetAfter(s.slice(amt.index! + amt[0].length));
    if (t === null) return null;
    return { kind: 'amount', value: parseFloat(amt[1]), ...t };
  }
  // $99 ounces / eighths for $20
  const W = '(eighths?|8ths?|quarters?|half[- ]?(?:oz|ounces?)|ounces?|oz|zips?)';
  const f1 = s.match(new RegExp(`\\$\\s?(\\d+(?:\\.\\d+)?)\\s*${W}\\b`, 'i'));
  const f2 = s.match(new RegExp(`\\b${W}\\s*(?:for|at|only|just)\\s*\\$\\s?(\\d+(?:\\.\\d+)?)`, 'i'));
  const price = f1 ? parseFloat(f1[1]) : f2 ? parseFloat(f2[2]) : 0;
  const g = weightIn((f1 ?? f2)?.[0] ?? '');
  if (price && g) return { kind: 'fixed', value: price, grams: g };
  return undefined;
}

export interface DealTextInput {
  title: string;
  body?: string;
  /** Source says this is a first-time-customer deal. */
  firstTime?: boolean;
  /** Category names attached by the source. */
  categoryHints?: string[];
  /** Source attached a product list, so "select items" deals are still targetable. */
  hasProductTarget?: boolean;
  forceAudience?: Audience;
}

/**
 * Turn free-text deal copy into Deal shapes. Conservative: anything without a clear value, or restricted to
 * unnamed "select" items, is dropped (returns fewer/no deals rather than invented numbers).
 */
export function parseDealText(input: DealTextInput): ParsedDeal[] {
  const title = cleanSegment(input.title ?? '');
  // "Up to 50% off" never tells us the actual value.
  if (/\bup to\s*\$?\d+\s*%?/i.test(title)) return [];
  const body = cleanSegment((input.body ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '));
  const all = `${title} ${body}`;
  const finePrint = [title, body].filter(Boolean).join(' - ');

  // Candidate segments: title pieces first; body sentences only if the title has no offer.
  const titleSegs = title.split(/\s*[;|•]\s*|\s+\+\s+|\s+&\s+(?=\$?\d)/).filter(Boolean);
  let found: { seg: string; offer: Offer }[] = [];
  let skippedSelect = false;
  for (const seg of titleSegs) {
    if (!input.hasProductTarget && SELECT_RE.test(seg)) { skippedSelect ||= !!offerIn(seg.replace(SELECT_RE, '')); continue; }
    const o = offerIn(seg);
    if (o) found.push({ seg, offer: o });
  }
  // Title offer was for "select" items: the body usually restates it without the word, so don't guess from it.
  if (!found.length && body && !skippedSelect) {
    for (const seg of body.split(/(?<=[.!?])\s+|\s*[|;•\n]\s*|!+/).map((x) => x.trim()).filter(Boolean)) {
      if (!input.hasProductTarget && SELECT_RE.test(seg)) {
        if (offerIn(seg.replace(SELECT_RE, ''))) break; // first offer in body is a "select items" offer: give up
        continue;
      }
      const o = offerIn(seg);
      if (o === null) break;
      if (o) {
        // Body copy is noisy: an untargeted, everyone-gets-it BOGO/bundle buried there is usually for select items.
        const targeted = input.hasProductTarget || !!o.brands?.length || !!o.grams || categoriesIn(seg).length > 0;
        const audience = input.forceAudience ?? audienceIn(title) ?? audienceIn(seg);
        if ((o.kind === 'bogo' || o.kind === 'bundle') && !targeted && !audience) break;
        found = [{ seg, offer: o }];
        break;
      }
    }
  }
  if (!found.length) return [];

  const titleAudience = audienceIn(title);
  const everyDay = /\bevery ?day\b|\bdaily\b|\ball day\b|\b7 days\b/i.test(title);
  const titleDays = daysIn(title);
  const stackable = stackableIn(all);
  const hintCats = (input.categoryHints ?? []).flatMap((h) => categoriesIn(h).length ? categoriesIn(h) : [mapCategory(h)]).filter((c) => c !== 'other');

  return found.map(({ seg, offer }) => {
    // Days: from this offer's own text; else from the body when the title names no day at all.
    const days = everyDay ? undefined : daysIn(seg) ?? (titleDays ? (titleSegs.length === 1 ? titleDays : undefined) : daysIn(body));
    const audience: Audience = input.forceAudience ?? titleAudience ?? audienceIn(seg) ?? (input.firstTime ? 'first_time' : 'everyone');
    const appliesTo: DealTarget = {};
    const cats = [...new Set([...categoriesIn(seg), ...hintCats])];
    if (offer.grams && !cats.length) cats.push('flower');
    if (cats.length) appliesTo.categories = cats;
    if (offer.brands?.length) appliesTo.brands = offer.brands;
    if (offer.grams) { appliesTo.minGrams = offer.grams; appliesTo.maxGrams = offer.grams; }
    const conditions = conditionsIn(all, audience);
    const d: ParsedDeal = {
      title: input.title.trim(),
      kind: offer.kind,
      audience,
      appliesTo,
      conditions,
      finePrint,
    };
    if (offer.value != null) d.value = offer.value;
    if (offer.bundleQty) { d.bundleQty = offer.bundleQty; d.bundlePrice = offer.bundlePrice; }
    if (offer.bogoBuy) { d.bogoBuy = offer.bogoBuy; d.bogoGetPct = offer.bogoGetPct; }
    if (days) d.days = days;
    if (stackable !== undefined) d.stackable = stackable;
    return d;
  }).filter((d) => {
    // A storewide "BOGO on everything" is almost never what's meant; without a target it's for unnamed items.
    if (d.kind !== 'bogo' && d.kind !== 'bundle') return true;
    const t = d.appliesTo;
    return input.hasProductTarget || !!t.categories?.length || !!t.brands?.length || t.minGrams != null;
  });
}

/** "taxes included" / "plus tax" text -> true/false/undefined. */
export function taxIncludedFromText(s: string | undefined | null): boolean | undefined {
  if (!s) return undefined;
  const t = s.replace(/<[^>]+>/g, ' ');
  if (/tax(es)?\s*(?:are\s*|is\s*)?(?:already\s*)?included|includes?\s*(?:all\s*)?(?:the\s*)?tax|tax[- ]inclusive|prices?\s*(?:are\s*)?out[- ]the[- ]door|\botd prices?\b|no (added|hidden) tax/i.test(t)) return true;
  if (/plus tax|\+\s*tax|before tax(es)?|tax(es)? (?:are )?not included|excludes? tax|pre[- ]tax|taxes? (?:will be )?added at/i.test(t)) return false;
  return undefined;
}

// ======================================================================================
// Adapter
// ======================================================================================

const money = (m: any): number => (m && typeof m.cents === 'number' ? m.cents / 100 : typeof m?.amount === 'number' ? m.amount : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const listingPath = (l: any) => (l.type === 'delivery' ? 'deliveries' : l.type === 'doctor' ? 'doctors' : 'dispensaries');
const stripHtml = (s: string | null | undefined) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(page: Page, url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const r = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { headers: { accept: 'application/json' } });
        return { status: res.status, text: await res.text() };
      } catch (e) {
        return { status: 0, text: String(e) };
      }
    }, url);
    if (r.status === 200) return JSON.parse(r.text);
    if (attempt < 2 && (r.status === 0 || r.status === 429 || r.status >= 500)) {
      await pause(3000 + attempt * 4000);
      continue;
    }
    throw new Error(`HTTP ${r.status} for ${url.replace(API, '')}: ${r.text.slice(0, 160)}`);
  }
}

async function runPool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

function deliveryOption(l: any): DeliveryOption | undefined {
  const oo = l.online_ordering;
  const delivers = l.type === 'delivery' || (l.retailer_services ?? []).includes('delivery') || oo?.enabled_for_delivery;
  if (!delivers) return undefined;
  const opt: DeliveryOption = {
    via: 'weedmaps',
    fee: round2(money(oo?.fee) + money(oo?.wm_service_fee)),
    minimum: round2(money(oo?.purchase_min)),
  };
  const eta = oo?.eta_max || oo?.standard_eta_max;
  if (eta) opt.etaMinutes = eta;
  return opt;
}

function toStore(l: any, detail: any | undefined, menuTaxFlag: boolean | undefined): Store {
  const slug = l.slug;
  const isDelivery = l.type === 'delivery';
  const d = detail ?? {};
  const textTax = taxIncludedFromText([l.intro_body, d.intro_body, d.description, d.announcement, d.price_visibility_announcement].filter(Boolean).join(' '));
  const taxIncluded = menuTaxFlag === true || textTax === true ? true : textTax === false ? false : menuTaxFlag ?? null;
  const delivery: DeliveryOption[] = [];
  const opt = deliveryOption(l);
  if (opt) delivery.push(opt);
  const website: string | undefined = d.website ? String(d.website).replace(/[?&]utm_[^#]*$/, '') || undefined : undefined;
  return {
    id: `weedmaps:${slug}`,
    name: l.name,
    address: l.address ?? '',
    city: l.city ?? '',
    lat: l.latitude,
    lng: l.longitude,
    phone: l.phone_number ?? undefined,
    website,
    menuUrl: website,
    sources: [{ source: 'weedmaps', externalId: slug, url: l.web_url }],
    pickup: !isDelivery && ((l.retailer_services ?? []).includes('storefront') || (l.retailer_services ?? []).includes('pickup') || l.type === 'dispensary'),
    ownSitePickup: null,
    taxIncluded,
    delivery,
    hours: weeklyHoursToOsm(d.business_hours ?? l.business_hours),
  };
}

const STRAIN: Record<string, Product['strainType']> = { indica: 'indica', sativa: 'sativa', hybrid: 'hybrid', cbd: 'cbd' };

function variantGrams(v: any): number | undefined {
  const w = v?.weight;
  if (w && typeof w.value === 'number' && w.value > 0) {
    if (w.unit === 'oz') return Math.round(w.value * 28 * 1000) / 1000;
    if (w.unit === 'g') return w.value;
    if (w.unit === 'mg') return w.value / 1000;
  }
  return parseGrams(v?.label);
}

/** Menu item -> one Product per price variant. */
export function itemToProducts(item: any, storeId: string, listingUrl: string): Product[] {
  const name: string = String(item.name ?? '').trim();
  if (!name) return [];
  // Hardware listed under Vape pens / Gear-ish names.
  if (/\bbatter(y|ies)\b|\bcharger\b|\bgrinder\b|\blighter\b|\brolling papers?\b/i.test(name) && !parseGrams(name)) return [];
  const edge = item.edge_category;
  const catHints = [...(edge?.ancestors ?? []).map((a: any) => a.name), edge?.name, item.category?.name].filter(Boolean).join(' ');
  let category = mapCategory(catHints);
  if (category === 'other' && !/wellness|topical|tincture|gear|accessor|apparel/i.test(catHints)) category = mapCategory(name);
  if (/tincture|topical|balm|lotion|cream|patch/i.test(catHints) && category === 'edible') category = 'other';

  const variants: any[] = [];
  for (const [k, v] of Object.entries(item.prices ?? {})) {
    if (k === 'grams_per_eighth') continue;
    for (const x of Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) variants.push(x);
  }
  if (!variants.length && item.price?.price) variants.push(item.price);

  const agg = item.metrics?.aggregates ?? {};
  const thcPct = agg.thc_unit === '%' && agg.thc > 0 && agg.thc <= 100 ? agg.thc : undefined;
  const aggMg = agg.thc_unit === 'mg' && agg.thc > 0 ? agg.thc : undefined;
  const genetics = String(item.genetics_tag?.name ?? item.category?.name ?? '').toLowerCase();
  const strainType = STRAIN[genetics];
  const brand: string | undefined = item.brand_endorsement?.brand_name ?? undefined;
  const nameGrams = parseGrams(name);
  const unitMatch = name.match(/\b(\d{1,2})\s*(?:pk|pack|ct|count|pc|pcs|pieces)\b|\b(\d{1,2})-pack\b|\(\s*(\d{1,2})\s*\)/i);
  const unitCount = unitMatch ? parseInt(unitMatch[1] ?? unitMatch[2] ?? unitMatch[3]) : undefined;
  const url = item.slug ? `${listingUrl}/menu/${item.slug}` : listingUrl;

  const out: Product[] = [];
  const seen = new Set<string>();
  variants.forEach((v, idx) => {
    const cur = Number(v.price);
    if (!cur || cur <= 0) return;
    const orig = Number(v.original_price);
    // Weedmaps shows add-on promos as absurd "sale" prices (e.g. $0.73 with purchase): ignore sales under 10% of list.
    const onSale = !!v.on_sale && orig > cur && cur >= orig * 0.1;
    const listPrice = v.on_sale && orig > cur ? orig : cur;
    const vg = variantGrams(v);
    let grams: number | undefined;
    if (category !== 'edible') {
      // Single-variant items: the store's own name ("... 3.5g") is the most specific; multi-variant: use the variant.
      grams = variants.length > 1 ? vg ?? nameGrams : nameGrams ?? vg;
      if (!grams && /\b8th\b/i.test(name)) grams = 3.5;
      if (!grams && v.compliance_net_mg > 0 && category !== 'other') grams = v.compliance_net_mg / 1000;
    }
    let thcMg: number | undefined;
    if (category === 'edible' || category === 'other') {
      const fromName = parseThcMg(name, v.label === 'each' ? undefined : v.label);
      const m = Math.max(fromName ?? 0, aggMg ?? 0);
      if (m > 0) thcMg = m;
    }
    // Implausible prices (Weedmaps "with purchase" add-ons listed at $0.73, $9.99 ounces) would win every comparison.
    const eff = onSale ? cur : listPrice;
    if (eff < 1) return;
    if (grams && ((category === 'flower' && eff / grams < 1) || ((category === 'vape' || category === 'concentrate') && eff / grams < 3))) return;
    const vid = v.id ?? `${idx}`;
    if (seen.has(String(vid))) return;
    seen.add(String(vid));
    const p: Product = {
      id: `${storeId}:${item.id}:${vid}`,
      storeId,
      source: 'weedmaps',
      name: variants.length > 1 && v.label && v.label !== 'each' ? `${name} (${v.label})` : name,
      category,
      price: round2(listPrice),
      url,
    };
    if (brand) p.brand = brand;
    if (grams) p.grams = grams;
    if (thcMg) p.thcMg = thcMg;
    if (unitCount && unitCount > 1) p.unitCount = unitCount;
    if (thcPct) p.thcPct = thcPct;
    if (strainType) p.strainType = strainType;
    if (onSale) { p.salePrice = round2(cur); p.saleLabel = v.discount_label || item.current_deal_title || 'Sale'; }
    out.push(p);
  });
  return out;
}

function promoCodeDeal(l: any): ParsedDeal | undefined {
  const pc = l.promo_code;
  if (!pc || !pc.discount || pc.applies_to === 'delivery_fee') return undefined;
  const title = String(pc.title || `Promo code ${pc.code}`);
  const type = String(pc.discount_type ?? '').toLowerCase();
  const kind: Deal['kind'] | undefined = type === 'percent' ? 'percent' : /amount|flat|dollar|fixed_amount/.test(type) ? 'amount' : undefined;
  if (!kind) return undefined;
  const audience: Audience = /first|new/i.test(String(pc.prerequisite_customer_type ?? '')) || /first|1st|new|ftp|welcome/i.test(String(pc.code ?? ''))
    ? 'first_time' : audienceIn(title) ?? 'everyone';
  // The title says what it covers ("Get 40% off all STIIIZY products with code X"); reuse the text parser for the target.
  const parsed = parseDealText({ title: title.replace(/\bwith code\s+\S+/i, '') });
  // Title names a target we can't model ("all Buddies Brand products", "select items"): skip rather than apply storewide.
  if (!parsed.length && (SELECT_RE.test(title) || /\boff\b/i.test(title))) return undefined;
  const appliesTo: DealTarget = parsed[0]?.appliesTo ?? {};
  const text = `${title} ${pc.redemption_details ?? ''} ${pc.description ?? ''}`;
  const conditions = conditionsIn(text, audience);
  if (pc.customer_discount_limit) conditions.limitPerCustomer = pc.customer_discount_limit;
  return {
    title,
    kind,
    value: kind === 'amount' && pc.discount > 100 && Number.isInteger(pc.discount) ? pc.discount / 100 : pc.discount,
    audience,
    appliesTo,
    conditions,
    finePrint: `Promo code ${pc.code}: only when ordering through Weedmaps. ${pc.redemption_details ?? ''}`.trim(),
    stackable: false,
  };
}

const dealKey = (d: ParsedDeal) => `${d.audience}|${d.kind}|${d.value ?? ''}|${d.bundleQty ?? ''}|${d.bundlePrice ?? ''}|${d.bogoBuy ?? ''}|${(d.appliesTo.categories ?? []).join(',')}|${(d.appliesTo.brands ?? []).join(',').toLowerCase()}|${(d.days ?? []).join(',')}`;

const baseName = (n: string) => n.toLowerCase().split(/\s[|–-]\s|\s\(/)[0].replace(/\b(delivery|deliveries)\b/g, '').replace(/[^a-z0-9]/g, '');

export const weedmapsAdapter: SourceAdapter = {
  id: 'weedmaps',
  enabled: () => config.sources.weedmaps,
  async fetchAll(area: SearchArea, log: (msg: string) => void): Promise<SourceResult> {
    return withContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      if (/just a moment|attention required|access denied|captcha/i.test(title)) throw new Error(`Weedmaps bot check: "${title}"`);

      // ---- listings ----
      const latlng = `${area.lat},${area.lng}`;
      const radius = Math.ceil(area.radiusMiles);
      const listings: any[] = [];
      const seenListing = new Set<number>();
      for (let p = 1; p <= 10; p++) {
        const url = `${API}/discovery/v2/listings?latlng=${latlng}&filter[bounding_latlng]=${latlng}&filter[bounding_radius]=${radius}mi`
          + `&filter[any_retailer_services][]=storefront&filter[any_retailer_services][]=delivery&sort_by=position_distance&sort_order=asc&page_size=100&page=${p}`;
        const j = await getJson(page, url);
        const batch: any[] = j?.data?.listings ?? [];
        for (const l of batch) if (!seenListing.has(l.id)) { seenListing.add(l.id); listings.push(l); }
        const total = j?.meta?.total_listings ?? 0;
        if (batch.length < 100 || listings.length >= total) break;
        await pause();
      }
      const inRange = listings
        .filter((l) => l.slug && typeof l.latitude === 'number' && (l.distance == null || l.distance <= area.radiusMiles))
        .filter((l) => l.type === 'dispensary' || l.type === 'delivery')
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
      const storefronts = inRange.filter((l) => l.type === 'dispensary');
      const deliveries = inRange.filter((l) => l.type === 'delivery');
      log(`${listings.length} listings (${storefronts.length} storefronts, ${deliveries.length} delivery services within ${area.radiusMiles} mi)`);

      // Delivery chains post one listing per zone with the same menu; keep the closest of each.
      const seenNames = new Set<string>();
      const deliveryPicks = deliveries.filter((l) => {
        const k = baseName(l.name);
        if (seenNames.has(k)) return false;
        seenNames.add(k);
        return (l.menu_items_count ?? 1) > 0;
      }).slice(0, MAX_DELIVERY_MENUS);
      const storefrontPicks = storefronts.filter((l) => (l.menu_items_count ?? 1) > 0).slice(0, MAX_STOREFRONT_MENUS);
      const toFetch = [...storefrontPicks, ...deliveryPicks];

      // ---- per-store detail + menus ----
      const details = new Map<string, any>();
      const taxFlags = new Map<string, boolean>();
      const products: Product[] = [];
      const itemIdsToProductIds = new Map<string, string[]>(); // `${slug}:${itemId}` -> product ids
      const dealItems = new Map<string, Set<string>>(); // `${slug}:${dealId}` -> item keys
      let failures = 0;

      await runPool(toFetch, CONCURRENCY, async (l) => {
        const slug = l.slug;
        const storeId = `weedmaps:${slug}`;
        const base = `${API}/discovery/v1/listings/${listingPath(l)}/${slug}`;
        try {
          const det = await getJson(page, base).catch((e) => { log(`${slug}: detail failed (${e.message})`); return null; });
          if (det?.data?.listing) details.set(slug, det.data.listing);
          await pause();
          const seen = new Set<number>();
          let count = 0;
          const take = (items: any[]) => {
            let fresh = 0;
            for (const it of items) {
              if (seen.has(it.id)) continue;
              seen.add(it.id);
              fresh++;
              if (it.price_visibility && it.price_visibility !== 'visible') continue;
              const ps = itemToProducts(it, storeId, l.web_url);
              products.push(...ps);
              const key = `${slug}:${it.id}`;
              itemIdsToProductIds.set(key, ps.map((x) => x.id));
              for (const did of it.deal_ids ?? []) {
                const dk = `${slug}:${did}`;
                if (!dealItems.has(dk)) dealItems.set(dk, new Set());
                dealItems.get(dk)!.add(key);
              }
              count += ps.length;
            }
            return fresh;
          };
          const menuPage = async (filter: string, p: number, order: 'asc' | 'desc') => {
            const j = await getJson(page, `${base}/menu_items?page=${p}&page_size=${PAGE_SIZE}&sort_by=min_price&sort_order=${order}${filter}`);
            if (typeof j?.meta?.has_taxes_included === 'boolean') taxFlags.set(slug, j.meta.has_taxes_included);
            await pause(MENU_PAGE_PAUSE_MS + Math.random() * MENU_PAGE_PAUSE_MS);
            return { items: (j?.data?.menu_items ?? []) as any[], total: (j?.meta?.total_menu_items ?? 0) as number };
          };
          let grandTotal = 0;
          const truncated: string[] = [];
          for (const g of MENU_GROUPS) {
            const filter = g.uuids.map((u) => `&filter[any_category_uuids][]=${u}`).join('');
            const first = await menuPage(filter, 1, 'asc');
            take(first.items);
            grandTotal += first.total;
            const pages = Math.ceil(first.total / PAGE_SIZE);
            if (pages <= 1) continue;
            if (pages <= g.maxPages) {
              for (let p = 2; p <= pages; p++) if (take((await menuPage(filter, p, 'asc')).items) === 0) break;
            } else {
              // Too big: keep the cheapest pages and the priciest pages (big sizes = best $/g), skip the middle.
              const desc = Math.floor(g.maxPages / 2), asc = g.maxPages - desc;
              for (let p = 2; p <= asc; p++) take((await menuPage(filter, p, 'asc')).items);
              for (let p = 1; p <= desc; p++) take((await menuPage(filter, p, 'desc')).items);
              truncated.push(`${g.name} ${g.maxPages * PAGE_SIZE}/${first.total}`);
            }
          }
          // Category filter matched nothing (taxonomy changed?): fall back to the plain menu, cheapest first.
          if (grandTotal === 0 && (l.menu_items_count ?? 0) > 0) {
            for (let p = 1; p <= FALLBACK_PAGES; p++) {
              const r = await menuPage('', p, 'asc');
              if (take(r.items) === 0 || r.items.length < PAGE_SIZE) break;
            }
            truncated.push('category filter returned nothing; used plain menu');
          }
          log(`${l.name} (${l.distance?.toFixed?.(1)} mi): ${count} products${truncated.length ? ` (partial: ${truncated.join(', ')})` : ''}`);
        } catch (e: any) {
          failures++;
          log(`${slug}: menu failed (${e?.message ?? e})`);
        }
      });

      // ---- stores ----
      const fetchedSlugs = new Set(toFetch.map((l) => l.slug));
      // All storefronts (their delivery/tax info helps merging with other sources); delivery services only if we read their menu.
      const storeListings = [...storefronts, ...deliveries.filter((l) => fetchedSlugs.has(l.slug))];
      const stores = storeListings.map((l) => toStore(l, details.get(l.slug), taxFlags.get(l.slug)));
      const storeSlugs = new Set(storeListings.map((l) => l.slug));
      const bySlug = new Map(storeListings.map((l) => [l.slug, l]));

      // ---- deals ----
      const rawDeals: any[] = [];
      try {
        const seenDeal = new Set<number>();
        for (let p = 1; p <= 10; p++) {
          await pause();
          const j = await getJson(page, `${API}/discovery/v1/deals?latlng=${latlng}&filter[bounding_radius]=${radius}mi&page_size=100&page=${p}`);
          const batch: any[] = j?.data?.deals ?? [];
          for (const d of batch) if (!seenDeal.has(d.id)) { seenDeal.add(d.id); rawDeals.push(d); }
          if (batch.length < 100 || rawDeals.length >= (j?.meta?.total_deals ?? 0)) break;
        }
      } catch (e: any) {
        log(`area deals failed (${e?.message ?? e})`);
      }

      const deals: Deal[] = [];
      const keysByStore = new Map<string, Set<string>>();
      const push = (slug: string, tag: string, d: ParsedDeal) => {
        const storeId = `weedmaps:${slug}`;
        const keys = keysByStore.get(storeId) ?? new Set<string>();
        keysByStore.set(storeId, keys);
        const k = dealKey(d);
        if (keys.has(k)) return;
        keys.add(k);
        deals.push({ ...d, id: `${storeId}:${tag}`, storeId, source: 'weedmaps' });
      };

      let unparsed = 0;
      for (const rd of rawDeals) {
        const slug = rd.listing?.slug;
        if (!slug || !storeSlugs.has(slug)) continue;
        // Product targets: ids the deal lists, plus items whose deal_ids reference it.
        const itemKeys = new Set<string>([...(rd.menu_item_ids ?? []).map((id: number) => `${slug}:${id}`), ...(dealItems.get(`${slug}:${rd.id}`) ?? [])]);
        const productIds = [...itemKeys].flatMap((k) => itemIdsToProductIds.get(k) ?? []);
        const parsed = parseDealText({
          title: rd.title ?? '',
          body: rd.body ?? '',
          firstTime: !!rd.first_time_customer,
          categoryHints: [...(rd.menu_item_category_names ?? []), ...(rd.categories ?? []).map((c: any) => c.name)],
          hasProductTarget: productIds.length > 0 && !rd.storewide,
        });
        if (!parsed.length) unparsed++;
        parsed.forEach((d, i) => {
          if (productIds.length && !rd.storewide) d.appliesTo.productIds = productIds;
          push(slug, `deal:${rd.id}:${i}`, d);
        });
      }
      for (const slug of storeSlugs) {
        const l = bySlug.get(slug)!;
        const pc = promoCodeDeal(l);
        if (pc) push(slug, `promo:${l.promo_code.code}`, pc);
        const det = details.get(slug);
        if (det?.first_time_announcement) {
          parseDealText({ title: stripHtml(det.first_time_announcement), forceAudience: 'first_time' })
            .forEach((d, i) => push(slug, `firsttime:${i}`, { ...d, title: d.title.length > 80 ? 'First-time customer offer' : d.title }));
        }
      }

      const withProducts = new Set(products.map((p) => p.storeId)).size;
      log(`done: ${stores.length} stores (${withProducts} with menus, ${failures} failed), ${products.length} products, ${deals.length} deals (${rawDeals.length} raw area deals, ${unparsed} unparseable)`);
      return { stores, products, deals };
    });
  },
};
