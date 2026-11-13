import type { Audience, Category, Deal, DealConditions, DealTarget, DeliveryOption, Product, Store } from '@gib/shared';
import type { SearchArea, SourceAdapter, SourceResult } from './types.ts';
import { config } from '../config.ts';
import type { Page } from 'playwright';
import { pause, withContext } from './browser.ts';
import { mapCategory, parseGrams, parseThcMg } from '../normalize.ts';
import { janeHoursToOsm } from '../hours.ts';

/**
 * iHeartJane. Everything comes from plain fetch, no browser needed:
 *  - stores near you: Algolia index `stores-production` (geo search) via Jane's Algolia proxy search.iheartjane.com
 *  - store details (tax_included, delivery zones, the store's own menu URL): GET api.iheartjane.com/v1/stores/<id>
 *  - menu: Algolia index `menu-products-production` filtered by store_id (one hit per product, with per-weight prices)
 *  - specials: GET api.iheartjane.com/v1/stores/<id>/specials
 * The Algolia app id / public search key are the ones the iheartjane.com frontend embeds in its HTML
 * (<script id="jane-app-settings"> / "jane-app-secrets"); we re-read them from the homepage each run and fall back to
 * the values below if that fails.
 */

const MAX_STORES = 60;
const CONCURRENCY = 3;
const SITE = 'https://www.iheartjane.com';
const API = 'https://api.iheartjane.com';
const FALLBACK_ALGOLIA = { appId: 'VFM4X0N23A', apiKey: 'edc5435c65d771cecbd98bbd488aa8d3', host: 'search.iheartjane.com' };
const ALGOLIA_PAGE_LIMIT = 1100; // the index's paginationLimitedTo
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Origin: SITE, Referer: `${SITE}/` };
const SKIP_KINDS = new Set(['gear', 'merch', 'grow']);

/** Jane weight keys -> grams. `each` has no fixed weight. */
const WEIGHTS: Record<string, number | undefined> = {
  half_gram: 0.5, gram: 1, two_gram: 2, eighth_ounce: 3.5, quarter_ounce: 7, half_ounce: 14, ounce: 28, each: undefined,
};
const WEIGHT_LABEL: Record<string, string> = {
  half_gram: '0.5g', gram: '1g', two_gram: '2g', eighth_ounce: '3.5g', quarter_ounce: '7g', half_ounce: '14g', ounce: '28g', each: '',
};
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

type Algolia = typeof FALLBACK_ALGOLIA;

// ---------------- http helpers ----------------

/**
 * Jane sits behind Cloudflare, which (as of 2026-11) rejects Node's fetch by TLS fingerprint but lets curl/browsers
 * through. So we try plain fetch first and, if that's blocked, run the same requests from inside a real Chromium page
 * on www.iheartjane.com (the site's own CORS policy allows its API + Algolia proxy from there).
 */
type RawFetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

const nodeFetch: RawFetch = async (url, init) => {
  const res = await fetch(url, { method: init.method, body: init.body, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: await res.text() };
};

function pageFetch(page: Page): RawFetch {
  return (url, init) => page.evaluate(async ({ url, init }) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
      return { status: r.status, text: await r.text() };
    } finally {
      clearTimeout(timer);
    }
  }, { url, init });
}

let raw: RawFetch = nodeFetch;

async function getText(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, tries = 2): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const { status, text } = await raw(url, init);
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} for ${url.slice(0, 120)}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await pause(1500 + Math.random() * 1000);
    }
  }
  throw lastErr;
}

async function getJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<any> {
  const text = await getText(url, init);
  if (text.trimStart().startsWith('<')) throw new Error(`got HTML instead of JSON from ${url.slice(0, 120)} (bot check?)`);
  return JSON.parse(text);
}

/** Is plain fetch let through right now? */
async function nodeFetchWorks(): Promise<boolean> {
  try {
    const r = await nodeFetch(`${API}/v1/stores/630`, {});
    return r.status !== 403 && !r.text.trimStart().startsWith('<');
  } catch {
    return false;
  }
}

async function loadAlgoliaKeys(log: (m: string) => void): Promise<Algolia> {
  try {
    const html = await getText(`${SITE}/`, {}, 1);
    const settings = JSON.parse(html.match(/id="jane-app-settings"[^>]*>([^<]+)</)?.[1] ?? '{}');
    const secrets = JSON.parse(html.match(/id="jane-app-secrets"[^>]*>([^<]+)</)?.[1] ?? '{}');
    if (settings.algoliaAppId && secrets.algoliaApiKey) {
      return { appId: settings.algoliaAppId, apiKey: secrets.algoliaApiKey, host: settings.algoliaUrl || `${settings.algoliaAppId}-dsn.algolia.net` };
    }
    log('could not find Algolia keys in iheartjane.com HTML; using built-in keys');
  } catch (e) {
    log(`homepage fetch failed (${(e as Error).message}); using built-in Algolia keys`);
  }
  return FALLBACK_ALGOLIA;
}

function algoliaHeaders(a: Algolia) {
  return { 'X-Algolia-Application-Id': a.appId, 'X-Algolia-API-Key': a.apiKey, 'Content-Type': 'application/json' };
}

async function algoliaQuery(a: Algolia, index: string, params: Record<string, string | number>): Promise<any> {
  const p = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return getJson(`https://${a.host}/1/indexes/${index}/query`, { method: 'POST', headers: algoliaHeaders(a), body: JSON.stringify({ params: p }) });
}

async function algoliaMulti(a: Algolia, requests: { indexName: string; params: Record<string, string | number> }[]): Promise<any[]> {
  const body = {
    requests: requests.map((r) => ({ indexName: r.indexName, params: new URLSearchParams(Object.entries(r.params).map(([k, v]) => [k, String(v)])).toString() })),
  };
  const j = await getJson(`https://${a.host}/1/indexes/*/queries`, { method: 'POST', headers: algoliaHeaders(a), body: JSON.stringify(body) });
  return j.results ?? [];
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGeoJson(geojson: unknown, lat: number, lng: number): boolean {
  try {
    const g = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
    const geoms: any[] = g?.type === 'FeatureCollection' ? g.features.map((f: any) => f.geometry) : g?.type === 'Feature' ? [g.geometry] : [g];
    for (const geom of geoms) {
      const polys: number[][][][] = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
      for (const poly of polys) {
        if (poly[0] && pointInPolygon(lng, lat, poly[0]) && !poly.slice(1).some((hole) => pointInPolygon(lng, lat, hole))) return true;
      }
    }
  } catch { /* bad geojson */ }
  return false;
}

// ---------------- stores ----------------

/** Does the store deliver to the user's home through Jane, and on what terms? */
function deliveryFor(s: any, area: SearchArea): DeliveryOption[] {
  if (!s.delivery) return [];
  const strategy = s.delivery_config_strategy?.delivery_strategy;
  const opt = (fee: unknown, min: unknown, eta?: unknown): DeliveryOption[] => [{
    via: 'store', fee: num(fee) ?? 0, minimum: num(min) ?? 0, ...(num(eta) ? { etaMinutes: num(eta) } : {}),
  }];
  if (strategy === 'zipcode') {
    const z = (s.delivery_zipcodes ?? []).find((x: any) => String(x.zipcode) === area.zip);
    return z ? opt(z.fee, z.min_amount ?? s.delivery_minimum) : [];
  }
  if (strategy === 'geofence') {
    const zone = (s.delivery_geofences ?? []).find((g: any) => inGeoJson(g.geojson, area.lat, area.lng));
    return zone ? opt(zone.fee ?? s.delivery_fee_amount, zone.cart_minimum ?? s.delivery_minimum) : [];
  }
  if (strategy === 'radius') {
    const r = num(s.delivery_radius);
    if (r == null || milesBetween(s.lat, s.long, area.lat, area.lng) > r) return [];
    return opt(s.delivery_fee_amount, s.delivery_minimum);
  }
  return []; // unknown strategy: don't guess
}

function toStore(hit: any, s: any | null, area: SearchArea): Store {
  const id = String(s?.id ?? hit.objectID);
  const slug = s?.url_slug ?? hit.url_slug;
  const janeUrl = `${SITE}/stores/${id}/${slug}`;
  const pickup = !!(s?.pickup ?? hit.pickup) || !!s?.curbside;
  const address = s?.address ?? String(hit.full_address ?? '').split(',')[0];
  return {
    id: `jane:${id}`,
    name: String(s?.name ?? hit.name).trim(),
    address: String(address).trim(),
    city: String(s?.city ?? hit.city ?? '').trim(),
    lat: num(s?.lat) ?? hit._geoloc?.lat,
    lng: num(s?.long) ?? hit._geoloc?.lng,
    phone: s?.phone ?? hit.phone ?? undefined,
    website: s?.subdomain_setting?.home_url || undefined,
    menuUrl: s?.current_jane_menu_url || janeUrl,
    sources: [{ source: 'jane', externalId: id, url: janeUrl }],
    pickup,
    // Jane is the store's own ordering system (embedded on their site and on iheartjane.com), so a Jane pickup
    // menu means you can order pickup directly from the dispensary.
    ownSitePickup: pickup ? true : null,
    taxIncluded: typeof s?.tax_included === 'boolean' ? s.tax_included : null,
    delivery: s ? deliveryFor(s, area) : [],
    hours: janeHoursToOsm(s?.working_hours),
  };
}

// ---------------- products ----------------

const PRODUCT_ATTRS = [
  'product_id', 'name', 'brand', 'product_brand_id', 'kind', 'kind_subtype', 'root_subtype', 'category', 'amount',
  'quantity_value', 'quantity_units', 'net_weight_grams', 'percent_thc', 'available_weights', 'url_slug',
  'special_title', 'special_amount', 'store_types', 'dosage',
  ...Object.keys(WEIGHTS).flatMap((w) => [`price_${w}`, `discounted_price_${w}`]),
];

/** Fetch a store's whole menu, splitting by facets so no single query exceeds Algolia's 1100-hit window. */
async function fetchMenu(a: Algolia, storeId: string, log: (m: string) => void): Promise<any[]> {
  const base = `store_id = ${Number(storeId)}`;
  const facetOrder = ['kind', 'root_subtype', 'brand'];
  const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const hitsParams = (filters: string) => ({
    filters, hitsPerPage: 1000, attributesToRetrieve: JSON.stringify(PRODUCT_ATTRS), attributesToHighlight: '[]', analytics: 'false',
  });
  const out = new Map<string, any>();

  // Returns hits for `filters`, splitting by the next facet when there are too many.
  const collect = async (filters: string, depth: number): Promise<void> => {
    const facet = facetOrder[depth];
    const head = await algoliaQuery(a, 'menu-products-production', { filters, hitsPerPage: 0, facets: JSON.stringify(facet ? [facet] : []), maxValuesPerFacet: 1000, analytics: 'false' });
    await pause(300 + Math.random() * 300);
    const total: number = head.nbHits ?? 0;
    if (!total) return;
    if (total <= 1000 || !facet) {
      if (total > 1000) log(`store ${storeId}: ${total} hits under "${filters}" can't be split further; taking first ${ALGOLIA_PAGE_LIMIT}`);
      const pages = Math.ceil(Math.min(total, ALGOLIA_PAGE_LIMIT) / 1000);
      for (let page = 0; page < pages; page++) {
        const r = await algoliaQuery(a, 'menu-products-production', { ...hitsParams(filters), page });
        for (const h of r.hits ?? []) out.set(String(h.objectID ?? h.product_id), h);
        await pause(300 + Math.random() * 300);
      }
      return;
    }
    const values: Record<string, number> = head.facets?.[facet] ?? {};
    const keys = Object.keys(values).filter((v) => !(depth === 0 && facet === 'kind' && SKIP_KINDS.has(v)));
    const small = keys.filter((k) => values[k] <= 1000);
    const big = keys.filter((k) => values[k] > 1000);
    // batch the small groups into multi-queries (a few per request)
    for (let i = 0; i < small.length; i += 6) {
      const reqs = small.slice(i, i + 6).map((k) => ({ indexName: 'menu-products-production', params: hitsParams(`${filters} AND ${facet}:${quote(k)}`) }));
      const results = await algoliaMulti(a, reqs);
      for (const r of results) for (const h of r.hits ?? []) out.set(String(h.objectID ?? h.product_id), h);
      await pause(300 + Math.random() * 300);
    }
    for (const k of big) await collect(`${filters} AND ${facet}:${quote(k)}`, depth + 1);
    // items with no value for this facet
    const covered = Object.values(values).reduce((s, n) => s + n, 0);
    if (covered < total && depth > 0) {
      const not = Object.keys(values).map((k) => `NOT ${facet}:${quote(k)}`).join(' AND ');
      const r = await algoliaQuery(a, 'menu-products-production', hitsParams(`${filters}${not ? ' AND ' + not : ''}`));
      for (const h of r.hits ?? []) out.set(String(h.objectID ?? h.product_id), h);
      await pause(300 + Math.random() * 300);
    }
  };

  await collect(base, 0);
  return [...out.values()];
}

const STRAINS = new Set(['indica', 'sativa', 'hybrid', 'cbd']);

function janeCategory(h: any): Category {
  return mapCategory(h.kind, h.root_subtype);
}

/** ".75g" -> "0.75g" (parseGrams would otherwise read "75g"). */
const fixDecimals = (s: unknown) => (s == null ? '' : String(s).replace(/(^|[^\d.])\.(\d)/g, (_m, a, b) => `${a}0.${b}`));

/** THC mg, preferring an explicit "... mg THC" over other cannabinoids ("500mg CBD/16mg THC" -> 16). */
function thcMgOf(s: string): number | undefined {
  if (!s) return undefined;
  const thc = s.match(/(\d+(?:\.\d+)?)\s*mg\s*(?:of\s*)?(?:total\s*)?(?:Δ9|d9|delta[- ]?9\s*)?thc\b(?!a|v)/i);
  if (thc) return parseFloat(thc[1]);
  if (/mg\s*(cbd|cbn|cbg|thca|thcv)\b/i.test(s) && !/thc\b/i.test(s)) return undefined; // CBD-only etc.
  return parseThcMg(s.replace(/mg(?=[a-z])/gi, 'mg '));
}

/** One Product per weight the hit is priced at. */
export function productsFromHit(h: any, storeKey: string, storeUrl: string): Product[] {
  if (SKIP_KINDS.has(h.kind)) return [];
  if (Array.isArray(h.store_types) && h.store_types.length && !h.store_types.includes('recreational')) return [];
  const category = janeCategory(h);
  const name = String(h.name ?? '').trim();
  if (!name) return [];
  const priced = Object.keys(WEIGHTS).filter((w) => (num(h[`price_${w}`]) ?? 0) > 0);
  const out: Product[] = [];
  const qtyGrams = String(h.quantity_units ?? '').toLowerCase() === 'g' ? num(h.quantity_value) : undefined;
  const nName = fixDecimals(name), nAmount = fixDecimals(h.amount);
  const explicitGrams = parseGrams(nName) ?? (category === 'edible' ? undefined : parseGrams(nAmount)) ?? (qtyGrams && qtyGrams > 0 ? qtyGrams : undefined);
  const isMg = category === 'edible' || /tincture|topical/.test(String(h.kind));
  const thcMg = isMg ? thcMgOf(nAmount) ?? thcMgOf(nName) ?? thcMgOf(fixDecimals(h.dosage)) : undefined;
  const pack = `${name} ${h.amount ?? ''}`.match(/(\d+)\s*(?:pk|pack|ct|count)\b/i);
  const unitCount = pack ? parseInt(pack[1]) : undefined;
  const strain = String(h.category ?? '').toLowerCase();
  const thc = num(h.percent_thc);
  // Shake, smalls and pre-ground aren't the same thing as whole buds: say so in the name when the menu does.
  const sub = [h.root_subtype, h.kind_subtype].map((x) => String(x ?? '').trim()).find((x) => /^(shake|trim|smalls?|popcorn|(pre[- ]?)?ground)\b/i.test(x));
  const form = category === 'flower' && sub && !new RegExp(sub.replace(/[^a-z]/gi, '.?'), 'i').test(name) ? ` (${sub})` : '';

  for (const w of priced) {
    const price = num(h[`price_${w}`])!;
    const disc = num(h[`discounted_price_${w}`]);
    let grams: number | undefined;
    if (w === 'each') {
      grams = isMg ? undefined : explicitGrams ?? ((num(h.net_weight_grams) ?? 0) > 0 ? num(h.net_weight_grams) : undefined);
    } else if (priced.length === 1 && explicitGrams && !isMg) {
      grams = explicitGrams; // e.g. "IRIS [4g]" sold under the eighth price slot
    } else {
      grams = WEIGHTS[w];
    }
    const label = priced.length > 1 && WEIGHT_LABEL[w] && !name.toLowerCase().includes(WEIGHT_LABEL[w]) ? ` ${WEIGHT_LABEL[w]}` : '';
    out.push({
      id: `${storeKey}:${h.product_id}:${w}`,
      storeId: storeKey,
      source: 'jane',
      name: `${name}${form}${label}`,
      brand: h.brand ? String(h.brand).trim() : undefined,
      category,
      grams,
      thcMg,
      unitCount: category === 'preroll' || category === 'edible' ? unitCount : undefined,
      thcPct: thc != null && thc > 0 && thc <= 100 && !isMg ? thc : undefined,
      strainType: STRAINS.has(strain) ? (strain as Product['strainType']) : undefined,
      price,
      url: h.url_slug ? `${storeUrl}/menu/products/${h.product_id}/${h.url_slug}` : undefined,
      ...(disc != null && disc > 0 && disc < price
        ? { salePrice: disc, saleLabel: [h.special_amount, h.special_title].filter(Boolean).join(' · ') || 'Sale' }
        : {}),
    });
  }
  return out;
}

// ---------------- deals ----------------

export interface ParsedDealText {
  kind: Deal['kind'];
  value?: number;
  bundleQty?: number;
  bundlePrice?: number;
  bogoBuy?: number;
  bogoGetPct?: number;
}

/** Who a deal is for, from its text. "Veterans Day sale" is NOT a veteran-only deal. */
export function audienceFromText(text: string): Audience {
  const t = text.toLowerCase();
  if (/first[- ]?time|new (customer|patient|member)s?|1st (time|order|visit)|first (order|visit|purchase)/.test(t)) return 'first_time';
  if (/\b(veterans?|military|vets?)\b(?!'?s?\s+day)/.test(t) && !/veterans?'?\s*day/.test(t)) return 'veteran';
  if (/\bseniors?\b|\b(65|60|55)\s*\+/.test(t)) return 'senior';
  if (/\bstudents?\b/.test(t)) return 'student';
  return 'everyone';
}

/** Parse "20% off", "$5 off", "2 for $50", "BOGO", "buy 2 get 1 50% off", "$25 eighths" style text. */
export function parseDealText(text: string): ParsedDealText | null {
  const t = text.replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\bbuy\s*(\d+)\s*(?:,\s*)?get\s*(\d+)\s*(?:(\d{1,3})\s*%\s*off|(?:for\s*)?(free|half[- ]off))/i))) {
    if (m[2] !== '1') return null;
    const pct = m[3] ? parseInt(m[3]) : /half/i.test(m[4] ?? '') ? 50 : 100;
    return { kind: 'bogo', bogoBuy: parseInt(m[1]), bogoGetPct: pct };
  }
  if ((m = t.match(/\bb(?:uy\s*)?1\s*g(?:et\s*)?1\s*(?:(\d{1,3})\s*%\s*off|(free)|(half[- ]off))?/i)) || (m = t.match(/\bbogo\b\s*(?:(\d{1,3})\s*%\s*off|(free)|(half[- ]off))?/i))) {
    const pct = m[1] ? parseInt(m[1]) : m[3] ? 50 : m[2] ? 100 : /\$\s*\d/.test(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12)) ? NaN : 100;
    if (Number.isNaN(pct)) return null; // "BOGO for $1" -> price depends on the item
    return { kind: 'bogo', bogoBuy: 1, bogoGetPct: pct };
  }
  if ((m = t.match(/\b(\d+)\s*(?:for|\/)\s*\$\s*(\d+(?:\.\d+)?)/i))) {
    const qty = parseInt(m[1]);
    if (qty >= 2 && qty <= 20) return { kind: 'bundle', bundleQty: qty, bundlePrice: parseFloat(m[2]) };
  }
  if ((m = t.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*off/i)) || (m = t.match(/(\d{1,2}(?:\.\d+)?)\s*%(?!\s*(?:thc|cbd|back|cash))/i))) {
    const v = parseFloat(m[1]);
    if (v > 0 && v < 100) return { kind: 'percent', value: v };
  }
  if ((m = t.match(/\$\s*(\d+(?:\.\d+)?)\s*off/i))) return { kind: 'amount', value: parseFloat(m[1]) };
  return null;
}

/** Day-of-week availability; undefined = every day; [] = never. */
function daysOf(sp: any): number[] | undefined {
  const on = DAYS.map((d, i) => (sp[`enabled_${d}`] === false ? -1 : i)).filter((i) => i >= 0);
  return on.length === 7 ? undefined : on;
}

function scheduleNote(sp: any): string | undefined {
  const sch = sp.schedule ?? {};
  const parts: string[] = [];
  DAYS.forEach((d) => {
    const s = sch[`start_time_${d}`], e = sch[`end_time_${d}`];
    if (s && e && !(s === '00:00' && (e === '23:45' || e === '23:59' || e === '00:00'))) parts.push(`${d.slice(0, 3)} ${s}-${e}`);
  });
  return parts.length ? `Hours: ${parts.join(', ')}` : undefined;
}

/** Jane end date ("YYYY-MM-DD") -> end of that day, Pacific. Far-future sentinel dates (e.g. 2077) are ignored. */
function expiresAt(sp: any): string | undefined {
  const d = String(sp.end_date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!d || parseInt(d[1]) > new Date().getFullYear() + 5) return undefined;
  return new Date(`${d[1]}-${d[2]}-${d[3]}T23:59:00-08:00`).toISOString();
}

function notStartedYet(sp: any): boolean {
  const d = String(sp.start_date ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return !!d && new Date(`${d[1]}T00:00:00-08:00`).getTime() > Date.now();
}

interface StoreCtx {
  storeKey: string;
  products: Product[];
  /** Jane product_id -> our Product ids (one per weight), and back */
  byJaneId: Map<string, Product[]>;
  janeIdOf: Map<string, string>;
  hitOf: Map<string, any>;
}

const weightOf = (p: Product) => p.id.slice(p.id.lastIndexOf(':') + 1);

/**
 * Resolve one Jane rule block ({product_ids, brand_ids, brands, kinds, weights, ...}) to the matching products of this
 * store. Returns null if the block contains a key we don't understand (so we never over-apply a deal).
 */
function matchBlock(block: any, ctx: StoreCtx): Set<string> | null {
  const known = new Set(['product_ids', 'included_product_ids', 'brand_ids', 'brands', 'kinds', 'weights', 'all_products']);
  for (const k of Object.keys(block ?? {})) if (!known.has(k) && block[k] != null && !(Array.isArray(block[k]) && !block[k].length)) return null;
  const pids: string[] = (block.product_ids ?? block.included_product_ids ?? []).map(String);
  const brandIds = new Set<string>((block.brand_ids ?? []).map(String));
  const brands = new Set<string>((block.brands ?? []).map((b: string) => String(b).toLowerCase().trim()));
  const kinds: { kind?: string; root_subtype?: string; brand_subtype?: string }[] = (block.kinds ?? []).map((k: any) => (typeof k === 'string' ? { kind: k } : k));
  const weights = new Set<string>((block.weights ?? []).map((w: string) => String(w).replace(/\s+/g, '_')));
  const out = new Set<string>();
  for (const p of ctx.products) {
    const jid = ctx.janeIdOf.get(p.id)!;
    const h = ctx.hitOf.get(jid);
    if (pids.length && !pids.includes(jid)) continue;
    if ((brandIds.size || brands.size) && !(brandIds.has(String(h?.product_brand_id)) || brands.has(String(h?.brand ?? '').toLowerCase().trim()))) continue;
    if (kinds.length && !kinds.some((k) => (!k.kind || k.kind === h?.kind) && (!k.root_subtype || k.root_subtype === h?.root_subtype) && (!k.brand_subtype || k.brand_subtype === h?.brand_subtype))) continue;
    if (weights.size && !weights.has(weightOf(p))) continue;
    out.add(p.id);
  }
  return out;
}

/** Products a special covers: union of `includes` minus union of `excludes`. null = can't tell. {} = everything. */
function resolveTargets(sp: any, ctx: StoreCtx, side?: any): { all: true } | { ids: string[] } | null {
  let includes: any[] | undefined, excludes: any[] | undefined;
  if (side) {
    includes = [side];
  } else {
    const rules = sp.rules;
    if (rules?.version === 2) {
      const set = Array.isArray(rules.rule_sets) ? rules.rule_sets[1] : undefined;
      if (set?.all_products || (!rules.includes?.length && !set?.includes)) {
        includes = undefined;
      } else {
        includes = rules.includes ?? (set?.includes ? [set.includes] : undefined);
      }
      excludes = rules.excludes ?? (set?.excludes ? [set.excludes] : undefined);
    } else {
      const c = sp.conditions?.product;
      includes = c && Object.keys(c).length ? [c] : undefined;
    }
  }
  if (!includes?.length && !excludes?.length) return { all: true };
  let ids: Set<string>;
  if (includes?.length) {
    ids = new Set();
    for (const b of includes) {
      const m = matchBlock(b, ctx);
      if (!m) return null;
      m.forEach((x) => ids.add(x));
    }
  } else {
    ids = new Set(ctx.products.map((p) => p.id));
  }
  for (const b of excludes ?? []) {
    const m = matchBlock(b, ctx);
    if (!m) return null;
    m.forEach((x) => ids.delete(x));
  }
  return { ids: [...ids] };
}

function targetToAppliesTo(t: { all: true } | { ids: string[] }): DealTarget {
  return 'all' in t ? {} : { productIds: t.ids };
}

const sameTarget = (a: any, b: any) => {
  const strip = (x: any) => JSON.stringify(Object.fromEntries(Object.entries(x ?? {}).filter(([k]) => !/threshold|max_number|max_applications/.test(k)).sort()));
  return strip(a) === strip(b);
};

/** Map one Jane special to Deal(s). Returns null (and a reason) when it can't be represented faithfully. */
export function dealFromSpecial(sp: any, ctx: StoreCtx): { deal?: Deal; skip?: string } {
  if (sp.enabled === false) return { skip: 'disabled' };
  if (notStartedYet(sp)) return { skip: 'not started' };
  const exp = expiresAt(sp);
  if (exp && new Date(exp).getTime() < Date.now()) return { skip: 'expired' };
  const days = daysOf(sp);
  if (days && !days.length) return { skip: 'no active days' };

  const title = String(sp.title ?? '').trim() || String(sp.discount_amount ?? 'Special');
  const desc = [sp.description, sp.terms].map((x) => (x ? String(x).trim() : '')).filter(Boolean);
  const rm = sp.reservation_modes ?? {};
  const conditions: DealConditions = {};
  if (rm.delivery === false && rm.pickup === false && rm.kiosk) conditions.inStoreOnly = true;
  else if (rm.delivery === false && rm.pickup) conditions.pickupOnly = true;
  else if (rm.pickup === false && rm.kiosk === false && rm.delivery) conditions.deliveryOnly = true;
  if (exp) conditions.expiresAt = exp;
  const fine: string[] = [...desc];
  if (sp.promo_code) fine.push(`Promo code: ${sp.promo_code}`);
  const sched = scheduleNote(sp);
  if (sched) fine.push(sched);

  const type = String(sp.special_type ?? '');
  const c = sp.conditions ?? {};
  let audience: Audience = audienceFromText([title, ...desc].join(' '));
  let appliesTo: DealTarget = {};
  let core: ParsedDealText | null = null;
  const pct = num(sp.discount_percent) ?? 0, dollars = num(sp.discount_dollar_amount) ?? 0, target = num(sp.discount_target_price) ?? 0;
  const simple = (): ParsedDealText | null =>
    sp.discount_type === 'percent' && pct > 0 && pct <= 100 ? { kind: 'percent', value: pct }
      : sp.discount_type === 'dollar_amount' && dollars > 0 ? { kind: 'amount', value: dollars }
        : sp.discount_type === 'target_price' && target > 0 ? { kind: 'fixed', value: target }
          : null;

  if (type === 'product') {
    const t = resolveTargets(sp, ctx);
    if (!t) return { skip: 'unknown product rule' };
    if ('ids' in t && !t.ids.length) return { skip: 'no matching products on menu' };
    appliesTo = targetToAppliesTo(t);
    core = simple();
  } else if (type === 'cart_total') {
    const thr = num(c.cart_total?.threshold) ?? num(sp.rules?.settings?.cart_threshold) ?? 0;
    if (thr > 0) conditions.minSpend = thr;
    core = simple();
    if (core?.kind === 'fixed') return { skip: 'cart target price' };
    // "$10 off your order" is per order, not per item: as a per-unit Deal it would make a $10 pre-roll free.
    if (core?.kind === 'amount') return { skip: 'cart-level $ off' };
    if (!core && dollars === 0 && pct === 0 && target === 0) return { skip: `unparseable cart_total: "${title}"` };
  } else if (type === 'qualified_group') {
    const g = String(c.qualified_group?.type ?? '').toLowerCase();
    const map: Record<string, Audience> = { senior: 'senior', seniors: 'senior', veteran: 'veteran', veterans: 'veteran', military: 'veteran', student: 'student', students: 'student', first_time: 'first_time', new_customer: 'first_time', first_time_customer: 'first_time' };
    if (!map[g]) return { skip: `qualified group "${g}"` };
    audience = map[g];
    if (audience === 'first_time') conditions.limitPerCustomer = 1;
    else conditions.idRequired = true;
    const req = num(c.qualified_group?.required_age);
    if (req && audience === 'senior') fine.push(`Age ${req}+`);
    const t = resolveTargets(sp, ctx);
    if (t) appliesTo = targetToAppliesTo(t);
    core = simple();
  } else if (type === 'bundle') {
    const b = c.bundle ?? {};
    const ind = b.independent ?? {}, dep = b.dependent ?? {};
    const buyN = num(ind.threshold_number_of_items_in_cart) ?? 1;
    const getM = num(dep.max_number_of_discounted_products) ?? 1;
    if (getM !== 1 || !sameTarget(ind, dep)) return { skip: 'bundle with different buy/get items' };
    const t = resolveTargets(sp, ctx, Object.fromEntries(Object.entries(dep).filter(([k]) => !/threshold|max_number|max_applications/.test(k))));
    if (!t) return { skip: 'unknown bundle rule' };
    if ('ids' in t && !t.ids.length) return { skip: 'no matching products on menu' };
    appliesTo = targetToAppliesTo(t);
    if (sp.discount_type === 'percent' && pct > 0) core = { kind: 'bogo', bogoBuy: buyN, bogoGetPct: Math.min(100, pct) };
    else return { skip: `bundle ${sp.discount_type} (get-item price depends on product)` };
    const maxApps = num(b.max_applications_per_cart);
    if (maxApps) fine.push(`Max ${maxApps} per order`);
  } else {
    // bulk_pricing, brand, or anything new: try the text.
    core = null;
  }

  if (!core) {
    const text = [title, ...desc, sp.discount_amount].filter(Boolean).join(' · ');
    core = parseDealText(text);
    if (!core) return { skip: `unparseable ${type || 'special'}: "${title}"` };
    if (type !== 'product' && type !== 'qualified_group' && type !== 'bundle' && type !== 'cart_total') {
      // unknown special type: we can't trust its product targeting
      fine.unshift(`Jane "${type}" special; product targeting approximate`);
    }
  }
  if (!fine.some((f) => f === title)) fine.unshift(title);

  return {
    deal: {
      id: `${ctx.storeKey}:special:${sp.id}`,
      storeId: ctx.storeKey,
      source: 'jane',
      title,
      ...core,
      audience,
      ...(days ? { days } : {}),
      appliesTo,
      conditions,
      finePrint: fine.join(' | '),
      // Jane applies the single best special per item by default; audience discounts (qualified groups) stack only
      // when a store configures it, which the API doesn't expose.
      stackable: false,
    },
  };
}

// ---------------- adapter ----------------

export const janeAdapter: SourceAdapter = {
  id: 'jane',
  enabled: () => config.sources.jane,
  async fetchAll(area: SearchArea, log: (msg: string) => void): Promise<SourceResult> {
    if (await nodeFetchWorks()) {
      raw = nodeFetch;
      return run(area, log);
    }
    log('plain fetch is blocked by Cloudflare; running requests inside a browser page');
    return withContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${SITE}/robots.txt`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      raw = pageFetch(page);
      try {
        return await run(area, log);
      } finally {
        raw = nodeFetch;
      }
    });
  },
};

async function run(area: SearchArea, log: (msg: string) => void): Promise<SourceResult> {
    const algolia = await loadAlgoliaKeys(log);
    const radiusM = Math.round(area.radiusMiles * 1609.34);
    const res = await algoliaQuery(algolia, 'stores-production', {
      aroundLatLng: `${area.lat},${area.lng}`, aroundRadius: radiusM, hitsPerPage: MAX_STORES * 2, attributesToHighlight: '[]',
    });
    const hits: any[] = (res.hits ?? [])
      .filter((h: any) => h.recreational !== false && h.marketplace_visible !== false)
      .map((h: any) => ({ h, d: milesBetween(area.lat, area.lng, h._geoloc?.lat, h._geoloc?.lng) }))
      .filter((x: any) => x.d <= area.radiusMiles)
      .sort((a: any, b: any) => a.d - b.d)
      .slice(0, MAX_STORES)
      .map((x: any) => x.h);
    log(`${res.nbHits ?? 0} Jane stores within ${area.radiusMiles} mi; ${hits.length} recreational to fetch`);

    const stores: Store[] = [], products: Product[] = [], deals: Deal[] = [];
    await pool(hits, CONCURRENCY, async (hit) => {
      const jid = String(hit.objectID);
      try {
        let detail: any = null;
        try {
          detail = (await getJson(`${API}/v1/stores/${jid}`)).store ?? null;
        } catch (e) {
          log(`store ${jid} details failed: ${(e as Error).message}`);
        }
        await pause();
        if (detail && detail.recreational === false) return;
        const store = toStore(hit, detail, area);
        const storeUrl = store.sources[0].url!;

        let menuHits: any[] = [];
        try {
          menuHits = await fetchMenu(algolia, jid, log);
        } catch (e) {
          log(`store ${jid} menu failed: ${(e as Error).message}`);
        }
        const ps = menuHits.flatMap((h) => productsFromHit(h, store.id, storeUrl));

        const ctx: StoreCtx = { storeKey: store.id, products: ps, byJaneId: new Map(), janeIdOf: new Map(), hitOf: new Map() };
        for (const h of menuHits) ctx.hitOf.set(String(h.product_id), h);
        for (const p of ps) {
          const pid = p.id.split(':')[2];
          ctx.janeIdOf.set(p.id, pid);
          const arr = ctx.byJaneId.get(pid) ?? [];
          arr.push(p);
          ctx.byJaneId.set(pid, arr);
        }

        const ds: Deal[] = [];
        const skips: Record<string, number> = {};
        try {
          await pause();
          const sp = await getJson(`${API}/v1/stores/${jid}/specials`);
          for (const s of sp.specials ?? []) {
            const r = dealFromSpecial(s, ctx);
            if (r.deal) ds.push(r.deal);
            else if (r.skip) skips[r.skip.replace(/".*"/, '"…"')] = (skips[r.skip.replace(/".*"/, '"…"')] ?? 0) + 1;
          }
        } catch (e) {
          log(`store ${jid} specials failed: ${(e as Error).message}`);
        }

        stores.push(store);
        products.push(...ps);
        deals.push(...ds);
        const sk = Object.entries(skips).map(([k, n]) => `${k}×${n}`).join(', ');
        log(`${store.name} (${store.city}): ${ps.length} products, ${ds.length} deals${sk ? ` (skipped: ${sk})` : ''}`);
      } catch (e) {
        log(`store ${jid} failed: ${(e as Error).message}`);
      }
    });

    return { stores, products, deals };
}
