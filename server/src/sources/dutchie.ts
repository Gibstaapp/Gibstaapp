import type { Audience, Deal, DealConditions, DealTarget, DeliveryOption, Product, Store } from '@gib/shared';
import type { Page } from 'playwright';
import type { SearchArea, SourceAdapter, SourceResult } from './types.ts';
import { config } from '../config.ts';
import { withContext, pause } from './browser.ts';
import { mapCategory, parseGrams, parseThcMg } from '../normalize.ts';
import { dutchieHoursToOsm } from '../hours.ts';

/**
 * Dutchie (dutchie.com + the menus it embeds on dispensaries' own sites).
 *
 * How it works (verified Nov 2026):
 *  - dutchie.com sits behind Cloudflare, which rejects Node's fetch (403) but lets a real browser through.
 *    So we open dutchie.com once in Playwright and run every GraphQL call with fetch() *inside* that page.
 *  - Dutchie's frontend uses persisted queries (hashes change on deploys), but its Apollo servers also accept
 *    ad-hoc queries. We send our own slim queries, which is far smaller/faster than the persisted ones
 *    (FilteredProducts persisted = ~5MB per 100 products) and doesn't depend on hashes:
 *      /graphql        filteredDispensaries(filter: {nearLat, nearLng, distance, ...})
 *      /api-2/graphql  filteredProducts(filter: {...}, page, perPage)   (perPage is capped at 100 server-side)
 *      /api-2/graphql  filteredSpecials(filter: {dispensaryId, current: true})
 *  - Menu sale prices (recSpecialPrices) already include today's active "sale" specials, so those become
 *    Product.salePrice. Specials become Deals when they add information: day-of-week sales, bundles, BOGOs,
 *    spend thresholds. Targets (POS brand/category/product ids) are resolved against the store's own products.
 */

const ORIGIN = 'https://dutchie.com';
const MAX_STORES = 60;
const CONCURRENCY = 3;
const PER_PAGE = 100;
const MAX_PAGES = 40; // safety cap per store (4000 products)
// Product types we care about; skips accessories/apparel/etc. (fewer pages to fetch).
const PRODUCT_TYPES = ['Flower', 'Pre-Rolls', 'Vaporizers', 'Concentrate', 'Edible', 'Tincture'];
const TYPE_HINT: Record<string, string> = {
  'Flower': 'flower', 'Pre-Rolls': 'pre-roll', 'Vaporizers': 'vape', 'Concentrate': 'concentrate', 'Edible': 'edible',
  'Tincture': 'tincture', 'Topicals': 'topical', 'CBD': 'cbd', 'Accessories': 'accessory', 'Apparel': 'apparel',
};

// ---------- GraphQL plumbing ----------

/** Serialize a JS value as a GraphQL input literal (avoids needing the server's input type names). */
class GqlEnum { value: string; constructor(value: string) { this.value = value; } }
const gqlEnum = (v: string) => new GqlEnum(v);
function gqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof GqlEnum) return v.value;
  if (Array.isArray(v)) return `[${v.map(gqlLiteral).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${gqlLiteral(x)}`).join(', ')}}`;
  return JSON.stringify(v);
}

type Gql = (path: '/graphql' | '/api-2/graphql', query: string, variables?: Record<string, unknown>) => Promise<any>;

function makeGql(page: Page): Gql {
  return async (path, query, variables) => {
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await page.evaluate(async ({ url, query, variables }) => {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
          return { status: r.status, text: await r.text() };
        } catch (e) {
          return { status: 0, text: String(e) };
        }
      }, { url: ORIGIN + path, query, variables: variables ?? {} });
      if (res.status === 200) {
        const j = JSON.parse(res.text);
        if (j.errors?.length && !j.data) throw new Error(`GraphQL: ${j.errors.map((e: any) => e.message).join('; ').slice(0, 300)}`);
        return j.data;
      }
      lastErr = `HTTP ${res.status}: ${res.text.slice(0, 150).replace(/\s+/g, ' ')}`;
      if (res.status === 400) break; // query error; retrying won't help
      await pause(2000 + attempt * 3000);
    }
    throw new Error(lastErr);
  };
}

// ---------- raw shapes (only the fields we select) ----------

interface RawDispensary {
  id: string; name: string; cName: string; status?: string;
  recDispensary?: boolean; medicalDispensary?: boolean;
  offerPickup?: boolean; offerCurbsidePickup?: boolean; offerAnyPickupService?: boolean; offerDelivery?: boolean;
  phone?: string; address?: string;
  embeddedMenuUrl?: string | null; embedBackUrl?: string | null; menuUrl?: string | null;
  customDomainSettings?: { domain?: string | null } | null;
  location?: { ln1?: string; ln2?: string; city?: string; state?: string; zipcode?: string; geometry?: { coordinates?: number[] } };
  deliveryInfo?: { withinBounds?: boolean; fee?: number | null; minimum?: number | null } | null;
  feeTiers?: { fee?: string | null; min?: string | null; max?: string | null }[] | null;
  enabledOrderTypes?: { pickup?: boolean; inStorePickup?: boolean; curbsidePickup?: boolean; driveThruPickup?: boolean; delivery?: boolean } | null;
  taxConfig?: { taxes?: { type?: string; rate?: number; recreational?: boolean; medical?: boolean; stages?: { op?: string; type?: string }[] }[] } | null;
}

const DISPENSARY_FIELDS = `id name cName status recDispensary medicalDispensary offerPickup offerCurbsidePickup offerAnyPickupService offerDelivery
  phone address embeddedMenuUrl embedBackUrl menuUrl customDomainSettings { domain }
  location { ln1 ln2 city state zipcode geometry { coordinates } }
  deliveryInfo { withinBounds fee minimum } feeTiers { fee min max }
  enabledOrderTypes { pickup inStorePickup curbsidePickup driveThruPickup delivery }
  taxConfig { taxes { type rate recreational medical stages { op type } } }`;

interface RawProduct {
  id: string; Name: string; cName?: string; brandName?: string | null; brandId?: string | null;
  type?: string | null; subcategory?: string | null; strainType?: string | null;
  Options?: (string | null)[] | null;
  Prices?: (number | null)[] | null; recPrices?: (number | null)[] | null; medicalPrices?: (number | null)[] | null;
  recSpecialPrices?: (number | null)[] | null; medicalSpecialPrices?: (number | null)[] | null;
  THCContent?: { unit?: string | null; range?: (number | null)[] | null } | null;
  measurements?: { netWeight?: { unit?: string | null; values?: number[] | null } | null } | null;
  special?: boolean | null;
  specialData?: { saleSpecials?: { specialId?: string; specialName?: string | null; eligibleProductOptions?: string[] | null }[] | null } | null;
  POSMetaData?: {
    canonicalID?: string | null; canonicalBrandId?: string | null; canonicalCategoryId?: string | null;
    activeBatchTags?: { tagId?: string }[] | null; canonicalProductTags?: { tagId?: string }[] | null;
    children?: { canonicalID?: string | null; option?: string | null; canonicalEffectivePotencyMg?: number | null; activeBatchTags?: { tagId?: string }[] | null }[] | null;
  } | null;
  medicalOnly?: boolean | null; recOnly?: boolean | null;
}

const PRODUCT_FIELDS = `id Name cName brandName brandId type subcategory strainType Options Prices recPrices medicalPrices recSpecialPrices medicalSpecialPrices
  THCContent { unit range } measurements { netWeight { unit values } } special
  specialData { saleSpecials { specialId specialName eligibleProductOptions } }
  POSMetaData { canonicalID canonicalBrandId canonicalCategoryId activeBatchTags { tagId } canonicalProductTags { tagId }
    children { canonicalID option canonicalEffectivePotencyMg activeBatchTags { tagId } } }
  medicalOnly recOnly`;

interface RawCriteria {
  productGroup?: string | null;
  brandIds?: string[] | null; brandNames?: string[] | null;
  categoryIds?: string[] | null; categoryNames?: string[] | null;
  subcategoryIds?: string[] | null; subcategoryNames?: string[] | null;
  productIds?: string[] | null; enterpriseProductIds?: string[] | null; inventoryTags?: string[] | null;
  weights?: string[] | null; weightOperator?: string | null; matchOperator?: string | null;
  applicationRules?: { applicationType?: string | null; comparisonOperator?: string | null; quantity?: number | null }[] | null;
  discountAmount?: number | null; discountType?: string | null;
  totalQuantity?: { enabled?: boolean | null; quantity?: number | null } | null;
  totalSpend?: { enabled?: boolean | null; minimumSpend?: number | null } | null;
  exclusions?: RawCriteria[] | null;
}

interface RawSpecial {
  _id: string; active?: boolean | null; specialType?: string | null; name?: string | null;
  menuDisplayName?: string | null; menuDisplayDescription?: string | null; description?: string | null;
  menuType?: string | null; stackingMode?: string | null;
  isRecurring?: boolean | null; recurring?: { days?: number[] | null; startTime?: string | null; endTime?: string | null } | null;
  startStamp?: string | null; endStamp?: string | null;
  saleDiscounts?: RawCriteria[] | null; bogoConditions?: RawCriteria[] | null; bogoRewards?: RawCriteria[] | null;
  itemsForAPrice?: { enabled?: boolean | null; value?: string | null } | null;
  discountBundle?: { enabled?: boolean | null; discountType?: string | null; value?: string | null; applyTo?: string | null } | null;
  totalSpend?: { enabled?: boolean | null; minimumSpend?: number | null } | null;
}

const MATCH = `productGroup brandIds brandNames categoryIds categoryNames subcategoryIds subcategoryNames productIds enterpriseProductIds inventoryTags`;
const EXCL = `${MATCH} weights weightOperator matchOperator`;
const SALE_FIELDS = `${MATCH} weights weightOperator discountAmount discountType exclusions { ${EXCL} }`;
const COND_FIELDS = `${MATCH} weights weightOperator exclusions { ${EXCL} } totalQuantity { enabled quantity } totalSpend { enabled minimumSpend }`;
const REWARD_FIELDS = `${SALE_FIELDS} totalQuantity { enabled quantity } applicationRules { applicationType comparisonOperator quantity }`;
const SPECIAL_FIELDS = `_id active specialType name menuDisplayName menuDisplayDescription description menuType stackingMode
  isRecurring recurring { days startTime endTime } startStamp endStamp
  saleDiscounts { ${SALE_FIELDS} } bogoConditions { ${COND_FIELDS} } bogoRewards { ${REWARD_FIELDS} }
  itemsForAPrice { enabled value } discountBundle { enabled discountType value applyTo } totalSpend { enabled minimumSpend }`;

// ---------- small helpers ----------

const round2 = (n: number) => Math.round(n * 100) / 100;
const lc = (s: string | null | undefined) => (s ?? '').toLowerCase();
const num = (x: unknown): number | undefined => {
  const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const stripHtml = (s: string | null | undefined) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const hostOf = (u: string | null | undefined): string | undefined => {
  if (!u) return undefined;
  try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return undefined; }
};

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

// ---------- text parsing (fallback for specials whose structure we can't map) ----------

export interface ParsedDealText {
  kind?: Deal['kind'];
  value?: number;
  bundleQty?: number;
  bundlePrice?: number;
  bogoBuy?: number;
  bogoGetPct?: number;
  audience: Audience;
  conditions: DealConditions;
}

/** Audience from free text ("first time", "veterans", "seniors 65+", "students"). */
export function parseAudience(text: string): Audience {
  const s = text.toLowerCase();
  if (/first[- ]?time|new (customer|patient|client)s?|1st (time|visit|order)|first (visit|order|purchase)/.test(s)) return 'first_time';
  if (/veteran|military|\bvets?\b/.test(s)) return 'veteran';
  if (/\bseniors?\b|(?<![$\d.])\b(55|60|62|65)\s*(\+|and (over|up|older)|or older)(?!\s*(tax|tx))/.test(s)) return 'senior';
  if (/\bstudents?\b/.test(s)) return 'student';
  return 'everyone';
}

const WORD_NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10 };
const toNum = (x: string) => WORD_NUM[x.toLowerCase()] ?? parseInt(x);

/**
 * Parse a deal from its title/description: "20% off", "$5 off", "2 for $50", "4/$109", "Two for $12", "BOGO",
 * "B2G1", "Buy 2 Get 1 50% off", "8th for $5", plus audience and simple conditions.
 * Returns null when no discount can be read reliably; never guesses numbers. Prices stated "OTD" (tax included)
 * are not returned, since deal prices are pre-tax here.
 */
export function parseDealText(text: string): ParsedDealText | null {
  const s = text.replace(/\s+/g, ' ').trim();
  const conditions: DealConditions = {};
  if (/in[- ]store only|in[- ]store purchases? only/i.test(s)) conditions.inStoreOnly = true;
  if (/pick[- ]?up only/i.test(s)) conditions.pickupOnly = true;
  if (/delivery only/i.test(s)) conditions.deliveryOnly = true;
  if (/cash only/i.test(s)) conditions.cashOnly = true;
  const spend = s.match(/(?:spend|orders? (?:over|of)|purchases? (?:over|of)|min(?:imum)?(?: purchase| spend| order)?(?: of)?)\s*\$\s*(\d+(?:\.\d+)?)/i);
  if (spend) conditions.minSpend = parseFloat(spend[1]);
  const audience = parseAudience(s);
  if (audience !== 'everyone' && /\bid\b|identification/i.test(s)) conditions.idRequired = true;
  const base = { audience, conditions };
  const otd = /\botd\b|out the door|tax(es)? included|incl\.? tax/i.test(s);
  const penny = (x: string | undefined) => x != null && parseFloat(x) <= 0.01;

  // BOGO family. "Get one for $X" (X > a penny) has no fixed percentage, so it isn't returned.
  const bxgy = s.match(/\bbuy\s*(\d+|one|two|three)\s*,?\s*get\s*(\d+|one|a|an)\b(?:[^%$]{0,40}?(?:(\d{1,3})\s*%\s*off|\$\s*(\d*\.?\d+)|(free)))?/i);
  if (bxgy) {
    const buy = toNum(bxgy[1]), get = toNum(bxgy[2]);
    const pct = bxgy[3] ? parseInt(bxgy[3]) : bxgy[4] ? (penny(bxgy[4]) ? 100 : undefined) : bxgy[5] || /\bfree\b/i.test(s) ? 100 : undefined;
    if (pct != null && get >= 1 && buy % get === 0 && pct > 0 && pct <= 100) return { ...base, kind: 'bogo', bogoBuy: buy / get, bogoGetPct: pct };
    return null;
  }
  const bxgo = s.match(/\bb(\d)g(\d|o)\b(?:\s*(?:for\s*)?\$\s*(\d*\.?\d+))?/i);
  if (bxgo) {
    const buy = parseInt(bxgo[1]), get = bxgo[2].toLowerCase() === 'o' ? 1 : parseInt(bxgo[2]);
    if (bxgo[3] && !penny(bxgo[3])) return null;
    if (get >= 1 && buy % get === 0) return { ...base, kind: 'bogo', bogoBuy: buy / get, bogoGetPct: 100 };
    return null;
  }
  const bogo = s.match(/\bbogo\b(?:\s*(\d{1,3})\s*%(?:\s*off)?|\s*(?:for\s*)?\$\s*(\d*\.?\d+))?/i);
  if (bogo) {
    if (bogo[2]) return penny(bogo[2]) ? { ...base, kind: 'bogo', bogoBuy: 1, bogoGetPct: 100 } : null;
    const pct = bogo[1] ? parseInt(bogo[1]) : 100;
    return pct > 0 && pct <= 100 ? { ...base, kind: 'bogo', bogoBuy: 1, bogoGetPct: pct } : null;
  }
  // Bundles: "2 for $50", "4/$109", "3 @ $60", "Two for $12"
  const bundle = s.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|ten)\s*(?:for|\/|@)\s*\$\s*(\d+(?:\.\d+)?)/i);
  if (bundle) {
    const qty = toNum(bundle[1]), price = parseFloat(bundle[2]);
    if (otd) return null;
    if (qty >= 2 && price > 0) return { ...base, kind: 'bundle', bundleQty: qty, bundlePrice: price };
  }
  const pct = s.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*off/i) ?? s.match(/\boff\s*(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (pct) {
    const v = parseFloat(pct[1]);
    if (v > 0 && v < 100) return { ...base, kind: 'percent', value: v };
  }
  const amt = s.match(/\$\s*(\d+(?:\.\d+)?)\s*off/i);
  if (amt) return { ...base, kind: 'amount', value: parseFloat(amt[1]) };
  // "Eighths for $25": only when nothing else must be bought first.
  const fixed = s.match(/\b(?:for|only|just)\s*\$\s*(\d+(?:\.\d+)?)(?!\s*(?:\+|or more|min))/i);
  if (fixed && !otd && !/\b(buy|get|spend|with (any|purchase))\b/i.test(s)) return { ...base, kind: 'fixed', value: parseFloat(fixed[1]) };
  return null;
}

// ---------- store mapping ----------

function deliveryOf(d: RawDispensary): DeliveryOption[] {
  if (!d.offerDelivery || d.enabledOrderTypes?.delivery === false) return [];
  // deliveryInfo is computed for the search point (home): withinBounds false = they don't deliver there.
  // Its fee/minimum are in CENTS (350 / 2500 for a store whose fee tier says "$3.50, orders up to $25").
  const info = d.deliveryInfo;
  if (info?.withinBounds === false) return [];
  if (info && (info.fee != null || info.minimum != null)) {
    return [{ via: 'store', fee: round2((num(info.fee) ?? 0) / 100), minimum: round2((num(info.minimum) ?? 0) / 100) }];
  }
  // Fall back to fee tiers (order-total ranges -> fee). Use the tier for the smallest order.
  const tiers = (d.feeTiers ?? []).map((t) => ({ fee: num(t.fee), min: num(t.min) })).filter((t) => t.fee != null);
  if (tiers.length) {
    tiers.sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
    return [{ via: 'store', fee: tiers[0].fee!, minimum: tiers[0].min ?? 0 }];
  }
  return [];
}

/** Dutchie tax stages: op "add" at "checkout" = added on top of the menu price; noop at checkout = already in the price. */
function taxIncludedOf(d: RawDispensary, med: boolean): boolean | null {
  const taxes = (d.taxConfig?.taxes ?? []).filter((t) => (med ? t.medical : t.recreational) !== false && (t.rate ?? 0) > 0);
  if (!taxes.length) return null;
  const addedAtCheckout = taxes.map((t) => (t.stages ?? []).some((s) => s.type === 'checkout' && s.op === 'add'));
  if (addedAtCheckout.every(Boolean)) return false;
  if (addedAtCheckout.every((x) => !x)) return true;
  return null; // some taxes included, some added
}

function storeOf(d: RawDispensary, hours?: string): Store | null {
  const coords = d.location?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  const loc = d.location!;
  const address = [loc.ln1, loc.ln2].filter(Boolean).join(' ').trim() || (d.address ?? '').split(',')[0];
  const website = d.embedBackUrl || (d.customDomainSettings?.domain ? `https://${d.customDomainSettings.domain}` : undefined);
  // Only trust an embedded-menu URL on the store's own domain (some point at staging hosts like *.vercel.app).
  const siteHost = hostOf(website) ?? hostOf(d.customDomainSettings?.domain);
  const ownMenu = [d.menuUrl, d.embeddedMenuUrl].find((u) => u && /^https?:/i.test(u) && siteHost && hostOf(u)?.endsWith(siteHost));
  const dutchieUrl = `${ORIGIN}/dispensary/${d.cName}`;
  const pickup = !!(d.offerPickup || d.offerAnyPickupService || d.offerCurbsidePickup);
  const orderTypes = d.enabledOrderTypes;
  const onlinePickup = pickup && (orderTypes ? !!(orderTypes.pickup || orderTypes.inStorePickup || orderTypes.curbsidePickup || orderTypes.driveThruPickup) : true);
  const phone = d.phone && !/555-?5555/.test(d.phone) ? d.phone : undefined;
  const med = !d.recDispensary && !!d.medicalDispensary;
  return {
    id: `dutchie:${d.id}`,
    name: d.name.trim(),
    address,
    city: loc.city?.trim() || '',
    lat, lng,
    phone,
    website: website ?? undefined,
    menuUrl: ownMenu ?? dutchieUrl,
    sources: [{ source: 'dutchie', externalId: d.id, url: dutchieUrl }],
    pickup,
    // Orders placed through Dutchie are orders with the dispensary itself (its own menu), not a marketplace.
    ownSitePickup: onlinePickup,
    taxIncluded: taxIncludedOf(d, med),
    delivery: deliveryOf(d),
    ...(hours ? { hours } : {}),
  };
}

// ---------- product mapping ----------

/** One menu option of a product, plus what we need to match specials against it. */
interface OptionRef {
  product: Product;
  raw: RawProduct;
  option: string;
  optionGrams?: number;
  posIds: Set<string>;
  tagIds: Set<string>;
}

const STRAIN: Record<string, Product['strainType']> = { indica: 'indica', sativa: 'sativa', hybrid: 'hybrid', 'high cbd': 'cbd', cbd: 'cbd' };

function productsOf(raw: RawProduct, store: Store, cName: string, med: boolean): OptionRef[] {
  if (!med && raw.medicalOnly) return [];
  const opts = raw.Options?.length ? raw.Options : [null];
  const prices = (med ? raw.medicalPrices : raw.recPrices)?.length ? (med ? raw.medicalPrices : raw.recPrices)! : (raw.Prices ?? []);
  const specials = (med ? raw.medicalSpecialPrices : raw.recSpecialPrices) ?? [];
  const typeHint = raw.type ? TYPE_HINT[raw.type] : undefined;
  const name = raw.Name.trim();
  // Batteries/kits are filed under Vaporizers; they're hardware, not product.
  const hardware = /batter(y|ies)|starter kit|vaporizer kit|\bdevice\b|charger/i.test(`${raw.subcategory ?? ''} ${name}`) && !/\d\s*(g|mg)\b/i.test(name);
  const category = hardware ? 'other' : typeHint ? mapCategory(typeHint) : mapCategory(raw.type, raw.subcategory, name);
  const nameNum = name.replace(/(\d),(\d{3})\b/g, '$1$2'); // "1,000mg" -> "1000mg"
  const minGrams = category === 'flower' ? 0.5 : category === 'vape' || category === 'concentrate' ? 0.25 : 0.1;
  const plausible = (g: number | undefined) => (g != null && g >= minGrams && g <= 1000 ? g : undefined);
  const thc = raw.THCContent;
  const thcVals = (thc?.range ?? []).filter((x): x is number => typeof x === 'number' && x > 0);
  const thcPct = lc(thc?.unit) === 'percentage' && thcVals.length ? Math.max(...thcVals) : undefined;
  const thcMgContent = lc(thc?.unit) === 'milligrams' && thcVals.length ? Math.max(...thcVals) : undefined;
  const net = raw.measurements?.netWeight;
  const netGrams = net?.values?.length === 1 ? (lc(net.unit) === 'milligrams' ? net.values[0] / 1000 : lc(net.unit) === 'grams' ? net.values[0] : undefined) : undefined;
  const packMatch = name.match(/\b(\d{1,3})\s*-?\s*(?:pk|pack|ct|count|pcs|pieces)\b/i) ?? name.match(/\b(?:pack of|x)\s*(\d{1,3})\b/i);
  const unitCount = packMatch ? parseInt(packMatch[1]) : undefined;
  const strain = STRAIN[lc(raw.strainType)];
  const pos = raw.POSMetaData;
  const tagIds = new Set<string>([...(pos?.activeBatchTags ?? []), ...(pos?.canonicalProductTags ?? [])].map((t) => t.tagId!).filter(Boolean));
  const saleSpecials = raw.specialData?.saleSpecials ?? [];
  const url = raw.cName ? `${ORIGIN}/dispensary/${cName}/product/${raw.cName}` : `${ORIGIN}/dispensary/${cName}`;

  const out: OptionRef[] = [];
  opts.forEach((opt, i) => {
    const price = num(prices[i]);
    if (price == null || price <= 0) return;
    const option = (opt ?? '').trim();
    const optUsable = option && !/^n\/?a$/i.test(option);
    const child = pos?.children?.find((c) => c.option === opt) ?? (pos?.children?.length === 1 ? pos.children[0] : undefined);
    let grams: number | undefined, thcMg: number | undefined;
    if (category === 'edible' || raw.type === 'Tincture') {
      // Dutchie edible options are nominal (".1g" on a 10mg drink), so read THC mg from the name first.
      const fromName = parseThcMg(nameNum);
      const fallback = thcMgContent ?? child?.canonicalEffectivePotencyMg ?? undefined;
      thcMg = fromName ?? (fallback != null && fallback >= 2 ? fallback : undefined);
    } else if (category !== 'other' || raw.type === 'Tincture') {
      // Single-option products: the name's weight beats the option label (options are sometimes mistyped, ".05g" on a 0.5g pod).
      const fromName = plausible(parseGrams(nameNum));
      const fromOpt = optUsable ? plausible(parseGrams(option)) : undefined;
      grams = (opts.length === 1 ? fromName ?? fromOpt : fromOpt ?? fromName) ?? (opts.length === 1 ? plausible(netGrams) : undefined);
    }
    const sp = num(specials[i]);
    const onSale = sp != null && sp > 0 && sp < price - 0.004;
    const saleNames = saleSpecials
      .filter((s) => !s.eligibleProductOptions?.length || s.eligibleProductOptions.includes(option))
      .map((s) => s.specialName?.trim()).filter((x): x is string => !!x);
    const product: Product = {
      id: `${store.id}:${raw.id}:${option || i}`,
      storeId: store.id,
      source: 'dutchie',
      name: optUsable && !lc(name).includes(lc(option)) && opts.length > 1 ? `${name} (${option})` : name,
      brand: raw.brandName?.trim() || undefined,
      category,
      grams,
      thcMg,
      unitCount: unitCount && unitCount > 1 && unitCount <= 100 ? unitCount : undefined,
      thcPct: thcPct && thcPct <= 100 ? thcPct : undefined,
      strainType: strain,
      price: round2(price),
      url,
      ...(onSale ? { salePrice: round2(sp!), saleLabel: [...new Set(saleNames)].join(' + ') || 'Sale' } : {}),
    };
    const posIds = new Set<string>([raw.id, pos?.canonicalID, child?.canonicalID].filter((x): x is string => !!x));
    for (const t of child?.activeBatchTags ?? []) if (t.tagId) tagIds.add(t.tagId);
    out.push({ product, raw, option, optionGrams: optUsable ? parseGrams(option) : undefined, posIds, tagIds });
  });
  return out;
}

// ---------- special -> deal ----------

const hasAny = (a?: unknown[] | null) => !!a && a.length > 0;

function brandMatch(c: RawCriteria, r: OptionRef): boolean {
  const ids = [r.raw.brandId, r.raw.POSMetaData?.canonicalBrandId].filter(Boolean) as string[];
  return (c.brandIds ?? []).some((b) => ids.includes(b)) || (c.brandNames ?? []).some((b) => lc(b) === lc(r.raw.brandName));
}
function categoryMatch(c: RawCriteria, r: OptionRef): boolean {
  const catId = r.raw.POSMetaData?.canonicalCategoryId;
  return (!!catId && (c.categoryIds ?? []).includes(catId))
    || (c.categoryNames ?? []).some((n) => lc(n) === lc(r.raw.type))
    || (c.subcategoryNames ?? []).some((n) => lc(n) === lc(r.raw.subcategory))
    || (!!r.raw.subcategory && (c.subcategoryIds ?? []).includes(r.raw.subcategory));
}
function weightMatch(c: RawCriteria, r: OptionRef): boolean {
  if (!hasAny(c.weights)) return true;
  const g = r.optionGrams;
  if (g == null) return false;
  const ws = c.weights!.map((w) => parseGrams(w)).filter((x): x is number => x != null);
  if (!ws.length) return false;
  const op = lc(c.weightOperator);
  if (op === 'greaterthan') return ws.some((w) => g > w + 0.01);
  if (op === 'greaterthanequalto') return ws.some((w) => g >= w - 0.01);
  if (op === 'lessthan') return ws.some((w) => g < w - 0.01);
  if (op === 'lessthanequalto') return ws.some((w) => g <= w + 0.01);
  return ws.some((w) => Math.abs(g - w) < 0.05);
}
const idMatch = (c: RawCriteria, r: OptionRef) => (c.productIds ?? []).some((id) => r.posIds.has(id)) || (c.enterpriseProductIds ?? []).some((id) => r.posIds.has(id));
const tagMatch = (c: RawCriteria, r: OptionRef) => (c.inventoryTags ?? []).some((t) => r.tagIds.has(t));

/** Does a Dutchie discount criteria block include this product option? null = can't evaluate. */
function criteriaMatch(c: RawCriteria, r: OptionRef): boolean | null {
  let ok: boolean;
  switch (c.productGroup) {
    case 'all': ok = true; break;
    case 'brands': ok = brandMatch(c, r); break;
    case 'categories': ok = categoryMatch(c, r) && (hasAny(c.brandIds) || hasAny(c.brandNames) ? brandMatch(c, r) : true); break;
    case 'individual': ok = idMatch(c, r); break;
    case 'inventory_tags': ok = tagMatch(c, r); break;
    default: return null;
  }
  // Explicit product lists on a brand/category block narrow it ("select" items).
  if (ok && c.productGroup !== 'individual' && hasAny(c.productIds)) ok = idMatch(c, r);
  if (ok && !weightMatch(c, r)) ok = false;
  if (ok) {
    for (const ex of c.exclusions ?? []) {
      // Each listed dimension is a test; matchOperator "or" (the norm) excludes on any, "and" needs all.
      const tests: boolean[] = [];
      if (hasAny(ex.brandIds) || hasAny(ex.brandNames)) tests.push(brandMatch(ex, r));
      if (hasAny(ex.categoryIds) || hasAny(ex.categoryNames) || hasAny(ex.subcategoryNames) || hasAny(ex.subcategoryIds)) tests.push(categoryMatch(ex, r));
      if (hasAny(ex.productIds) || hasAny(ex.enterpriseProductIds)) tests.push(idMatch(ex, r));
      if (hasAny(ex.inventoryTags)) tests.push(tagMatch(ex, r));
      if (hasAny(ex.weights)) tests.push(weightMatch(ex, r));
      if (tests.length && (lc(ex.matchOperator) === 'and' ? tests.every(Boolean) : tests.some(Boolean))) return false;
    }
  }
  return ok;
}

/** Resolve a criteria block to our product ids. null = can't evaluate (unknown group). */
function resolveTarget(c: RawCriteria, refs: OptionRef[]): DealTarget | null {
  if (c.productGroup === 'all' && !hasAny(c.exclusions) && !hasAny(c.productIds) && !hasAny(c.weights)) return {};
  const ids: string[] = [];
  for (const r of refs) {
    const m = criteriaMatch(c, r);
    if (m === null) return null;
    if (m) ids.push(r.product.id);
  }
  return { productIds: ids };
}

const sameSet = (a: RawCriteria, b: RawCriteria) => {
  const key = (c: RawCriteria) => JSON.stringify([c.productGroup, [...(c.brandIds ?? [])].sort(), [...(c.categoryIds ?? [])].sort(), [...(c.brandNames ?? [])].sort(), [...(c.categoryNames ?? [])].sort(), [...(c.weights ?? [])].sort()]);
  return key(a) === key(b);
};

const FAR_FUTURE = Date.UTC(2100, 0, 1);

type PushDeal = (d: Omit<Deal, 'id' | 'storeId' | 'source' | 'title' | 'audience' | 'conditions'> & { conditions?: DealConditions; finePrint?: string; idSuffix?: string }) => void;

/** "Get one for $X" / "$X off one" can't be one bogo percentage, but it is exact per list price, so group by price. */
function bogoByPrice(buy: number, target: DealTarget, refs: OptionRef[], pctFor: (price: number) => number | undefined, push: PushDeal): boolean {
  if (!target.productIds) return false;
  const ids = new Set(target.productIds);
  const groups = new Map<number, string[]>();
  for (const r of refs) if (ids.has(r.product.id)) groups.set(r.product.price, [...(groups.get(r.product.price) ?? []), r.product.id]);
  let any = false;
  for (const [price, productIds] of groups) {
    const pct = pctFor(price);
    if (pct == null || pct <= 0) continue;
    push({ kind: 'bogo', bogoBuy: buy, bogoGetPct: Math.min(100, round2(pct)), appliesTo: { productIds }, idSuffix: `p${price}` });
    any = true;
  }
  return any;
}

const limitedToOne = (c: RawCriteria) => (c.applicationRules ?? []).some((a) => a.applicationType === 'totalQuantity' && (a.quantity ?? 0) === 1 && /lessthanequalto|equalto/i.test(a.comparisonOperator ?? ''));

/**
 * Map a Dutchie "bogo"-type special (really: any quantity/spend-based promo). Shapes seen in San Diego:
 *  - reward only, qty N, itemsForAPrice $X           -> "N for $X" bundle
 *  - reward only, qty N, rule "applies to 1 item"    -> buy N-1, get 1 at X% off / for $X / $X off
 *  - reward only, no rule, targetPrice $X, qty N>=2  -> every item $X when buying N = bundle N for N*X
 *  - reward only, percent, qty N                     -> X% off each (requires N)
 *  - spend condition + reward                        -> discount with conditions.minSpend
 *  - qty condition on the same set + reward          -> BOGO (counts from the title when it says so)
 * Cross-product combos ("buy an ounce, get a pre-roll for $1") are not representable and are skipped.
 */
function mapBogo(s: RawSpecial, refs: OptionRef[], title: string, push: PushDeal, finePrint: string): boolean {
  const conds = s.bogoConditions ?? [];
  const rewards = s.bogoRewards ?? [];
  if (rewards.length !== 1) return false;
  const reward = rewards[0];
  const target = resolveTarget(reward, refs);
  if (!target) return false;
  const qtyConds = conds.filter((c) => c.totalQuantity?.enabled && (c.totalQuantity.quantity ?? 0) > 0);
  const spendCond = conds.find((c) => c.totalSpend?.enabled && (c.totalSpend.minimumSpend ?? 0) > 0) ?? (s.totalSpend?.enabled ? ({ totalSpend: s.totalSpend } as RawCriteria) : undefined);
  const minSpend = num(spendCond?.totalSpend?.minimumSpend);
  const v = num(reward.discountAmount);
  const q = reward.totalQuantity?.enabled ? (reward.totalQuantity.quantity ?? 0) : 0;
  const type = reward.discountType;
  const parsed = parseDealText(title);
  const ifp = s.itemsForAPrice?.enabled ? num(s.itemsForAPrice.value) : undefined;
  const requires = (n: number) => (n >= 2 ? `${finePrint} Requires buying ${n}.`.trim() : finePrint);
  const getFor = (x: number) => (p: number) => (p > x ? ((p - x) / p) * 100 : undefined);

  if (!qtyConds.length && !minSpend) {
    if (ifp && q >= 2) { push({ kind: 'bundle', bundleQty: q, bundlePrice: ifp, appliesTo: target }); return true; }
    if (v == null || (v <= 0 && type !== 'targetPrice')) return false;
    if (limitedToOne(reward) && q >= 2) {
      const buy = q - 1;
      if (type === 'percentDiscount') { push({ kind: 'bogo', bogoBuy: buy, bogoGetPct: Math.min(100, v), appliesTo: target }); return true; }
      if (type === 'targetPrice') {
        if (v <= 0.01) { push({ kind: 'bogo', bogoBuy: buy, bogoGetPct: 100, appliesTo: target }); return true; }
        return bogoByPrice(buy, target, refs, getFor(v), push);
      }
      if (type === 'dollarDiscount') return bogoByPrice(buy, target, refs, (p) => (Math.min(v, p) / p) * 100, push);
      return false;
    }
    if (type === 'percentDiscount' && v < 100) { push({ kind: 'percent', value: v, appliesTo: target, finePrint: requires(q) }); return true; }
    if (type === 'targetPrice' && q >= 2) { push({ kind: 'bundle', bundleQty: q, bundlePrice: round2(v * q), appliesTo: target }); return true; }
    if (type === 'targetPrice') { push({ kind: 'fixed', value: v, appliesTo: target }); return true; }
    if (type === 'dollarDiscount' && q <= 1) { push({ kind: 'amount', value: v, appliesTo: target }); return true; }
  } else if (!qtyConds.length && minSpend && v != null && v > 0) {
    const conditions = { minSpend };
    if (type === 'percentDiscount' && v < 100) { push({ kind: 'percent', value: v, appliesTo: target, conditions }); return true; }
    if (type === 'dollarDiscount') { push({ kind: 'amount', value: v, appliesTo: target, conditions }); return true; }
    if (type === 'targetPrice') { push({ kind: 'fixed', value: v, appliesTo: target, conditions }); return true; }
  } else if (qtyConds.length === 1 && !minSpend && v != null && sameSet(qtyConds[0], reward)) {
    // A quantity condition on the same set usually counts the reward item too ("buy any, get a select one" = qty 2).
    const n = qtyConds[0].totalQuantity!.quantity!;
    const buy = parsed?.kind === 'bogo' && parsed.bogoBuy ? parsed.bogoBuy : Math.max(1, n - 1);
    if (type === 'percentDiscount' && v > 0) { push({ kind: 'bogo', bogoBuy: buy, bogoGetPct: Math.min(100, v), appliesTo: target }); return true; }
    if (type === 'targetPrice') {
      if (v <= 0.01) { push({ kind: 'bogo', bogoBuy: buy, bogoGetPct: 100, appliesTo: target }); return true; }
      return bogoByPrice(buy, target, refs, getFor(v), push);
    }
  }
  // Last resort: the title states explicit numbers ("Gelato 2 for $5 Pre-rolls" is built as "$1 off a 2-pack").
  if (parsed?.kind === 'bundle' || parsed?.kind === 'percent' || (parsed?.kind === 'bogo' && parsed.bogoGetPct === 100)) {
    if (qtyConds.length && !sameSet(qtyConds[0], reward)) return false; // cross-product combo
    const { kind, value, bundleQty, bundlePrice, bogoBuy, bogoGetPct } = parsed;
    push({ kind, value, bundleQty, bundlePrice, bogoBuy, bogoGetPct, appliesTo: target, conditions: minSpend ? { minSpend } : {} });
    return true;
  }
  return false;
}

function dealsOf(specials: RawSpecial[], refs: OptionRef[], store: Store, med: boolean, now: Date, log: (m: string) => void): Deal[] {
  const out: Deal[] = [];
  let skipped = 0;
  for (const s of specials) {
    try {
      if (s.active === false) continue;
      if (med ? s.menuType === 'recreational' : s.menuType === 'medical') continue;
      const start = num(s.startStamp), end = num(s.endStamp);
      if (start != null && start > now.getTime()) continue; // not started yet; a later refresh will pick it up
      if (end != null && end < now.getTime()) continue;
      const title = (s.menuDisplayName || s.name || '').trim();
      if (!title) continue;
      const desc = stripHtml(s.menuDisplayDescription || s.description);
      const days = s.isRecurring && s.recurring?.days?.length && s.recurring.days.length < 7 ? [...s.recurring.days].sort((a, b) => a - b) : undefined;
      const window = s.recurring?.startTime && s.recurring?.endTime ? `${s.recurring.startTime}–${s.recurring.endTime}` : undefined;
      const text = `${title} ${desc}`;
      const audience = parseAudience(text);
      const conditions: DealConditions = { ...(parseDealText(text)?.conditions ?? {}) };
      if (end != null && end < FAR_FUTURE) conditions.expiresAt = new Date(end).toISOString();
      const finePrint = [desc && desc !== title ? desc : '', window ? `Only ${window}.` : '', title].filter(Boolean).join(' ').trim();
      const baseDeal = {
        storeId: store.id, source: 'dutchie' as const, title, audience, days, conditions, finePrint,
        stackable: s.stackingMode === 'stacking',
      };
      const made: (Omit<Deal, 'id'> & { idSuffix?: string })[] = [];
      const push: PushDeal = (d) => {
        const t = d.appliesTo;
        if (t.productIds && !t.productIds.length) return; // nothing on this menu qualifies
        made.push({ ...baseDeal, ...d, finePrint: d.finePrint ?? baseDeal.finePrint, conditions: { ...baseDeal.conditions, ...(d.conditions ?? {}) } });
      };

      if (s.specialType === 'sale') {
        // Everyday sales for everyone are already in the menu's sale price (Product.salePrice); skip duplicates.
        if (!days && audience === 'everyone') continue;
        for (const sd of s.saleDiscounts ?? []) {
          const target = resolveTarget(sd, refs);
          const v = num(sd.discountAmount);
          if (!target || v == null || v <= 0) { skipped++; continue; }
          if (sd.discountType === 'percentDiscount' && v < 100) push({ kind: 'percent', value: v, appliesTo: target });
          else if (sd.discountType === 'dollarDiscount') push({ kind: 'amount', value: v, appliesTo: target });
          else if (sd.discountType === 'targetPrice') push({ kind: 'fixed', value: v, appliesTo: target });
          else skipped++;
        }
      } else if (s.specialType === 'bogo') {
        if (!mapBogo(s, refs, title, push, baseDeal.finePrint)) skipped++;
      } else {
        // Unknown special type: text only, and only with a resolvable target.
        const parsed = parseDealText(text);
        const target = s.saleDiscounts?.[0] ? resolveTarget(s.saleDiscounts[0], refs) : null;
        if (parsed?.kind && target) {
          const { kind, value, bundleQty, bundlePrice, bogoBuy, bogoGetPct } = parsed;
          push({ kind, value, bundleQty, bundlePrice, bogoBuy, bogoGetPct, appliesTo: target });
        } else skipped++;
      }
      made.forEach(({ idSuffix, ...d }, i) => out.push({ ...d, id: `${store.id}:special:${s._id}${idSuffix ? `:${idSuffix}` : made.length > 1 ? `:${i}` : ''}` }));
    } catch (e) {
      skipped++;
      log(`special ${s._id} at ${store.name}: ${(e as Error).message}`);
    }
  }
  if (skipped) log(`${store.name}: skipped ${skipped} specials that couldn't be mapped`);
  return out;
}

// ---------- adapter ----------

async function fetchProducts(gql: Gql, d: RawDispensary, med: boolean): Promise<RawProduct[]> {
  const all: RawProduct[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const filter = {
      dispensaryId: d.id, pricingType: med ? 'med' : 'rec', Status: 'Active', types: PRODUCT_TYPES,
      removeProductsBelowOptionThresholds: true, isKioskMenu: false, platformType: 'ONLINE_MENU', bypassOnlineThresholds: false,
    };
    // Variables (not literals) here: the filter has enum fields (pricingType) and variables coerce strings to enums.
    const data = await gql('/api-2/graphql',
      `query($f: productsFilterInput, $page: Int, $perPage: Int) { filteredProducts(filter: $f, page: $page, perPage: $perPage) { products { ${PRODUCT_FIELDS} } queryInfo { totalCount totalPages } } }`,
      { f: filter, page, perPage: PER_PAGE });
    const fp = data?.filteredProducts;
    const items: RawProduct[] = fp?.products ?? [];
    for (const it of items) if (!seen.has(it.id)) { seen.add(it.id); all.push(it); } // pages can overlap
    const pages = fp?.queryInfo?.totalPages ?? 0;
    if (!items.length || page + 1 >= pages) break;
    await pause(400 + Math.random() * 500);
  }
  return all;
}

async function fetchSpecials(gql: Gql, d: RawDispensary): Promise<RawSpecial[]> {
  const filter = { dispensaryId: d.id, current: true, platformType: 'ONLINE_MENU' };
  const data = await gql('/api-2/graphql', `{ filteredSpecials(filter: ${gqlLiteral(filter)}) { specials { ${SPECIAL_FIELDS} } } }`);
  return data?.filteredSpecials?.specials ?? [];
}

async function run(page: Page, area: SearchArea, log: (msg: string) => void): Promise<SourceResult> {
  const res = await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (res && res.status() >= 400) {
    const title = await page.title().catch(() => '');
    throw new Error(`dutchie.com returned HTTP ${res.status()} (${title || 'no title'}) — possibly a bot challenge`);
  }
  await pause(1000);
  const gql = makeGql(page);

  const dfilter = {
    nearLat: area.lat, nearLng: area.lng, distance: area.radiusMiles, sortBy: gqlEnum('distance'), activeOnly: true,
    destinationTaxState: 'CA', medical: false, recreational: false,
  };
  const data = await gql('/graphql', `{ filteredDispensaries(filter: ${gqlLiteral(dfilter)}) { ${DISPENSARY_FIELDS} } }`);
  const raws: RawDispensary[] = data?.filteredDispensaries ?? [];
  // Opening hours come from a separate small query, so a schema change there can never break the menus.
  const hoursById = new Map<string, string>();
  try {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d} { active start end }`).join(' ');
    const h = await gql('/graphql', `{ filteredDispensaries(filter: ${gqlLiteral(dfilter)}) { id hoursSettings { inStorePickup { effectiveHours { ${DAYS} } } } } }`);
    for (const d of h?.filteredDispensaries ?? []) {
      const hours = dutchieHoursToOsm(d?.hoursSettings?.inStorePickup?.effectiveHours);
      if (hours) hoursById.set(d.id, hours);
    }
    log(`opening hours for ${hoursById.size} of ${raws.length} dispensaries`);
  } catch (e) {
    log(`opening hours not available (${e instanceof Error ? e.message : e})`);
  }
  const candidates = raws
    .map((d) => ({ d, store: storeOf(d, hoursById.get(d.id)) }))
    .filter((x): x is { d: RawDispensary; store: Store } => !!x.store && x.d.status !== 'closed-permanently')
    .map((x) => ({ ...x, miles: haversineMiles(area.lat, area.lng, x.store.lat, x.store.lng) }))
    .filter((x) => x.miles <= area.radiusMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, MAX_STORES);
  log(`${raws.length} dispensaries returned, ${candidates.length} within ${area.radiusMiles} mi`);

  const stores: Store[] = [], products: Product[] = [], deals: Deal[] = [];
  const now = new Date();
  await pool(candidates, CONCURRENCY, async ({ d, store, miles }) => {
    const med = !d.recDispensary && !!d.medicalDispensary;
    try {
      const rawProducts = await fetchProducts(gql, d, med);
      await pause();
      let specials: RawSpecial[] = [];
      try { specials = await fetchSpecials(gql, d); } catch (e) { log(`${store.name}: specials failed: ${(e as Error).message}`); }
      const refs = rawProducts.flatMap((p) => productsOf(p, store, d.cName, med));
      const storeDeals = dealsOf(specials, refs, store, med, now, log);
      stores.push(store);
      products.push(...refs.map((r) => r.product));
      deals.push(...storeDeals);
      log(`${store.name} (${store.city}, ${miles.toFixed(1)} mi): ${refs.length} products, ${storeDeals.length}/${specials.length} specials -> deals${med ? ' [medical menu]' : ''}`);
    } catch (e) {
      log(`${store.name}: failed: ${(e as Error).message}`);
    }
    await pause();
  });
  return { stores, products, deals };
}

export const dutchieAdapter: SourceAdapter = {
  id: 'dutchie',
  enabled: () => config.sources.dutchie,
  async fetchAll(area, log) {
    return withContext(async (ctx) => {
      const page = await ctx.newPage();
      return run(page, area, log);
    });
  },
};
