import type { Audience, Category, Deal, DealConditions, DealTarget, Product, Store } from '@gib/shared';
import type { Page } from 'playwright';
import type { SearchArea, SourceAdapter, SourceResult } from './types.ts';
import { config } from '../config.ts';
import { captureJson, pause, withContext } from './browser.ts';
import { mapCategory, parseGrams, parseThcMg } from '../normalize.ts';

/**
 * Eaze (eaze.com) — delivery marketplace.
 *
 * How it works (observed Nov 2026, eaze.com release 30.x, Next.js front end):
 *   1. Load https://www.eaze.com/ in a real browser (Cloudflare cookies, age gate).
 *   2. GET /api/v1/places?query=<zip>&zipCode=true  -> "place" for the ZIP: its id plus the depot(s) that
 *      deliver there (depot name, license address + lat/lng, taxes, minimum order, delivery fee, menus).
 *   3. GET /api/v2/menus/<primaryMenu>?place_id=<placeId> -> the whole menu in one response:
 *      { groups: [{ slug, name, description, products: [...] }], promos: [...] }.
 *      Products repeat across groups; each product is already one size (SKU).
 *      Deals are groups like "Save the errand... 30% Off." / "Use Code: 30OFF" whose products carry a
 *      tag { tagType: 'deal', text: 'USE CODE 30OFF' }.
 * No login needed and none is attempted. Both calls run inside the page (fetch) so cookies match.
 * If the direct calls fail we fall back to typing the address into the site's picker and capturing
 * the same responses.
 *
 * Prices: listed pre-tax. The depot JSON carries a `taxes` array (Local Canna Tax, Sales Tax) that
 * Eaze adds at checkout ("Taxes & fees" line), and listed prices equal the catalog's
 * suggested_retail_price, so taxIncluded = false.
 */

const BASE = 'https://www.eaze.com';

// ---------- raw API shapes (only fields we use) ----------

interface EazeDepot {
  id: number;
  name?: string;
  displayName?: string;
  dispensaryId?: number;
  isEnabled?: boolean;
  primaryMenu?: string;
  minimumOrderAmount?: number;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string | null;
  adultUseLicense?: string;
  asapDeliveryCompleteBeforeTargetMinutes?: number;
  depotAddress?: { address1?: string; address2?: string | null; city?: string; state?: string; postalCode?: string };
  depotPaymentSettings?: { isDeliveryFeeEnabled?: boolean; deliveryFeeAmount?: number; minimumAmountBypassDeliveryFee?: number };
  taxes?: { name: string; rate: number }[];
}

interface EazePlace {
  id: string;
  zipCode?: string | null;
  cityName?: string | null;
  isAreaSupported?: boolean;
  menus?: string[];
  depots?: EazeDepot[];
}

interface EazeTag { id?: string; text?: string; tagType?: string }

interface EazeProduct {
  id: number;
  catalogItemId?: string;
  slug?: string;
  name: string;
  price: number;
  weight?: number;
  thc?: number;
  thcMeasure?: string;
  highCBD?: boolean;
  isAccessory?: boolean;
  isAvailable?: boolean;
  isShown?: boolean;
  tag?: EazeTag | null;
  type?: { name?: string };
  subtype?: { name?: string };
  species?: { name?: string };
  brand?: { name?: string };
}

interface EazeGroup { id?: string; slug?: string; name?: string; description?: string; products?: EazeProduct[] }
interface EazeMenu { slug?: string; groups?: EazeGroup[]; promos?: any[] }

// ---------- deal text parsing ----------

export interface ParsedDeal {
  kind: Deal['kind'];
  value?: number;
  bundleQty?: number;
  bundlePrice?: number;
  bogoBuy?: number;
  bogoGetPct?: number;
  audience: Audience;
  days?: number[];
  categories?: Category[];
  conditions: DealConditions;
  codes: string[];
}

const DAY_RES: [RegExp, number][] = [
  [/\bsun(day)?s?\b/i, 0], [/\bmon(day)?s?\b/i, 1], [/\btue(s|sday)?s?\b/i, 2], [/\bwed(nesday)?s?\b/i, 3],
  [/\bthu(r|rs|rsday)?s?\b/i, 4], [/\bfri(day)?s?\b/i, 5], [/\bsat(urday)?s?\b/i, 6],
];
const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\bflowers?\b|\beighths?\b|\bbuds?\b/i, 'flower'],
  [/\bpre-?rolls?\b|\bjoints?\b|\bblunts?\b/i, 'preroll'],
  [/\bvapes?\b|\bcarts?\b|\bcartridges?\b|\bdisposables?\b|\bpods?\b|\ball-in-ones?\b|\baios?\b/i, 'vape'],
  [/\bconcentrates?\b|\bwax\b|\bdabs?\b|\brosin\b|\bbadder\b|\bshatter\b|\bdiamonds?\b|\bsauce\b/i, 'concentrate'],
  [/\bedibles?\b|\bgumm(y|ies)\b|\bchocolates?\b|\bdrinks?\b|\bbeverages?\b|\bmints?\b/i, 'edible'],
];
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (s: string) => NUM_WORDS[s.toLowerCase()] ?? parseInt(s, 10);
// Words that may follow "get 1 free" without naming a *different* item.
const GENERIC_ITEM = /^(item|items|one|product|products|unit|units|of equal|equal|same|of|lesser|at|for|on|with|\W*)$/i;

/**
 * Parse promo text like "20% off", "$10 off your first order", "2 for $40", "BOGO", "Buy 2 get 1 free",
 * "Wax Wednesday 25% off concentrates", "Use Code: 30OFF". Returns null if no deal value can be read
 * (never guesses numbers). Gift-with-purchase deals ("buy 2 pods, get a free battery") return null too.
 */
export function parseDealText(text: string): ParsedDeal | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let core: Pick<ParsedDeal, 'kind' | 'value' | 'bundleQty' | 'bundlePrice' | 'bogoBuy' | 'bogoGetPct'> | null = null;

  const bundle = t.match(/\b(\d+)\s*(?:for|\/)\s*\$\s*(\d+(?:\.\d{1,2})?)/i);
  const buyGet = t.match(/\bbuy\s+(\d+|one|two|three|a|an)\b(.*?)\bget\s+(\d+|one|a|an|the)?\s*(?:(?:\S+\s+){0,2}?)(free|(\d{1,3})\s*%\s*off|half\s*off)\b\s*(\S+)?/i);
  const bogo = /\bbogo\b|\bbuy\s+one,?\s+get\s+one\b|\bb1g1\b/i.test(t);
  const pct = t.match(/(?<!up to\s*)(?<!\d)(\d{1,2}(?:\.\d+)?)\s*%\s*off\b/i);
  const amt = t.match(/(?<!up to\s*)\$\s*(\d+(?:\.\d{1,2})?)\s*off\b/i);

  if (bundle && parseInt(bundle[1], 10) >= 2) {
    core = { kind: 'bundle', bundleQty: parseInt(bundle[1], 10), bundlePrice: parseFloat(bundle[2]) };
  } else if (buyGet) {
    const after = (buyGet[6] ?? '').replace(/[^a-z0-9-]/gi, '');
    const bought = buyGet[2].trim().toLowerCase();
    const sameItem = !after || GENERIC_ITEM.test(after) || (bought && bought.includes(after.toLowerCase().replace(/s$/, '')));
    if (sameItem) {
      const getPct = buyGet[4].toLowerCase() === 'free' ? 100 : /half/i.test(buyGet[4]) ? 50 : parseInt(buyGet[5], 10);
      if (getPct > 0 && getPct <= 100) core = { kind: 'bogo', bogoBuy: num(buyGet[1]), bogoGetPct: getPct };
    }
    // else: free *different* item (gift with purchase) -> can't express, skip
  } else if (bogo) {
    const half = t.match(/bogo\s*(\d{1,3})\s*%/i);
    core = { kind: 'bogo', bogoBuy: 1, bogoGetPct: half ? parseInt(half[1], 10) : 100 };
  } else if (pct) {
    const v = parseFloat(pct[1]);
    if (v > 0 && v < 100) core = { kind: 'percent', value: v };
  } else if (amt) {
    const v = parseFloat(amt[1]);
    if (v > 0) core = { kind: 'amount', value: v };
  }
  if (!core) return null;

  const audience: Audience =
    /\bfirst[- ]?(time|order|purchase)|\bnew (customer|patient|user)s?\b|\b1st order\b/i.test(t) ? 'first_time'
      : /\bveterans?\b|\bmilitary\b/i.test(t) ? 'veteran'
        : /\bseniors?\b/i.test(t) ? 'senior'
          : /\bstudents?\b/i.test(t) ? 'student'
            : 'everyone';

  const days = DAY_RES.filter(([re]) => re.test(t)).map(([, d]) => d);
  const categories = CATEGORY_WORDS.filter(([re]) => re.test(t)).map(([, c]) => c);
  const conditions: DealConditions = {};
  const min = t.match(/\b(?:orders?|spend|purchases?)\s+(?:of\s+|over\s+|above\s+|\$?\d+\s*\+?\s*or more)?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*\+?/i)
    ?? t.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*\+?\s*(?:min(?:imum)?|or more)\b/i);
  if (min) conditions.minSpend = parseFloat(min[1]);
  if (audience === 'first_time') conditions.limitPerCustomer = 1;
  conditions.deliveryOnly = true; // Eaze is delivery-only

  const codes = [...t.matchAll(/\bcode[:\s]+["']?([A-Z0-9]{3,20})\b/gi)].map((m) => m[1].toUpperCase());

  return {
    ...core,
    audience,
    ...(days.length && days.length < 7 ? { days } : {}),
    ...(categories.length ? { categories } : {}),
    conditions,
    codes: [...new Set(codes)],
  };
}

// ---------- mapping ----------

const round2 = (n: number) => Math.round(n * 100) / 100;

function mapProduct(p: EazeProduct, storeId: string): Product | null {
  if (p.isAccessory || p.isAvailable === false || p.isShown === false) return null;
  if (!(p.price > 0)) return null;
  const typeName = p.type?.name ?? '';
  const subName = p.subtype?.name ?? '';
  if (/accessor/i.test(typeName)) return null;
  const category = mapCategory(typeName, subName);
  const isMg = (p.thcMeasure ?? '').toLowerCase() === 'mg';
  const weighed = ['flower', 'preroll', 'vape', 'concentrate'].includes(category);

  // `weight` is grams for flower/prerolls/vapes/concentrates; for edibles it is THC in grams (0.1 = 100mg), so ignore it there.
  let grams: number | undefined;
  if (weighed) grams = p.weight && p.weight > 0 ? p.weight : parseGrams(p.name, subName);

  let thcMg: number | undefined;
  if (!weighed) thcMg = isMg && p.thc && p.thc > 0 ? p.thc : parseThcMg(p.name);

  const pack = p.name.match(/(\d+)\s*-?\s*(?:pack|pk)\b/i);
  const species = (p.species?.name ?? '').toLowerCase();
  const strainType = p.highCBD || species === 'cbd' ? 'cbd'
    : species === 'indica' || species === 'sativa' || species === 'hybrid' ? species : undefined;

  return {
    id: `${storeId}:${p.id}`,
    storeId,
    source: 'eaze',
    name: p.name.trim(),
    brand: p.brand?.name?.trim() || undefined,
    category,
    ...(grams ? { grams } : {}),
    ...(thcMg ? { thcMg } : {}),
    ...(pack && parseInt(pack[1], 10) > 1 ? { unitCount: parseInt(pack[1], 10) } : {}),
    ...(!isMg && p.thc && p.thc > 0 && p.thc <= 100 ? { thcPct: p.thc } : {}),
    ...(strainType ? { strainType } : {}),
    price: round2(p.price),
    url: p.slug && p.catalogItemId ? `${BASE}/products/${p.slug}/cid/${p.catalogItemId}` : `${BASE}/menu`,
  };
}

function mapStore(depot: EazeDepot, place: EazePlace, area: SearchArea): Store {
  const pay = depot.depotPaymentSettings ?? {};
  const a = depot.depotAddress ?? {};
  const fee = pay.isDeliveryFeeEnabled === false ? 0 : pay.deliveryFeeAmount ?? 0;
  const label = depot.displayName || depot.name;
  return {
    id: `eaze:${depot.id}`,
    name: label ? `Eaze (${label})` : 'Eaze (delivery)',
    address: [a.address1, a.address2].filter(Boolean).join(' ') || `${place.cityName ?? 'San Diego'}, CA`,
    city: a.city || place.cityName || 'San Diego',
    lat: depot.latitude ?? area.lat,
    lng: depot.longitude ?? area.lng,
    ...(depot.phoneNumber ? { phone: depot.phoneNumber } : {}),
    website: BASE,
    menuUrl: `${BASE}/menu`,
    sources: [{ source: 'eaze', externalId: String(depot.id), url: `${BASE}/menu` }],
    pickup: false,
    ownSitePickup: false,
    taxIncluded: false,
    delivery: [{
      via: 'eaze',
      fee,
      minimum: depot.minimumOrderAmount ?? 0,
      ...(depot.asapDeliveryCompleteBeforeTargetMinutes ? { etaMinutes: depot.asapDeliveryCompleteBeforeTargetMinutes } : {}),
    }],
  };
}

const codeOf = (tag?: EazeTag | null) => tag?.text?.match(/code[:\s]+([A-Z0-9]{3,20})/i)?.[1]?.toUpperCase();

function buildDeals(menu: EazeMenu, storeId: string, products: Map<number, Product>): Deal[] {
  const deals: Deal[] = [];
  const seen = new Set<string>();
  const all = (menu.groups ?? []).flatMap((g) => g.products ?? []);

  const push = (title: string, raw: string, productIds: string[] | undefined, key: string) => {
    const parsed = parseDealText(raw);
    if (!parsed || seen.has(key)) return;
    seen.add(key);
    const appliesTo: DealTarget = {};
    if (productIds?.length) appliesTo.productIds = productIds;
    else if (parsed.categories) appliesTo.categories = parsed.categories;
    const codeNote = parsed.codes.length ? ` Promo code: ${parsed.codes.join(', ')} (enter at checkout).` : '';
    deals.push({
      id: `${storeId}:deal:${key}`,
      storeId,
      source: 'eaze',
      title: title.replace(/\s+/g, ' ').trim().slice(0, 120),
      kind: parsed.kind,
      ...(parsed.value !== undefined ? { value: parsed.value } : {}),
      ...(parsed.bundleQty ? { bundleQty: parsed.bundleQty, bundlePrice: parsed.bundlePrice } : {}),
      ...(parsed.bogoBuy ? { bogoBuy: parsed.bogoBuy, bogoGetPct: parsed.bogoGetPct } : {}),
      audience: parsed.audience,
      ...(parsed.days ? { days: parsed.days } : {}),
      appliesTo,
      conditions: parsed.conditions,
      finePrint: `${raw.replace(/\s+/g, ' ').trim()}${codeNote}`,
    });
  };

  // 1) Deal groups ("30% Off" + "Use Code: 30OFF"). Products = the group's + any product tagged with the same code.
  for (const g of menu.groups ?? []) {
    const text = [g.name, g.description].filter(Boolean).join(' — ');
    const parsed = parseDealText(text);
    if (!parsed) continue;
    const ids = new Set<number>((g.products ?? []).map((p) => p.id));
    for (const code of parsed.codes) for (const p of all) if (codeOf(p.tag) === code) ids.add(p.id);
    const productIds = [...ids].map((id) => products.get(id)?.id).filter((x): x is string => !!x);
    if (!productIds.length) continue; // only accessories etc.
    push(g.name || text, text, productIds, `group:${g.slug ?? g.id}`);
  }

  // 2) Menu-level promos (empty when observed; shape unknown, so read any text fields).
  for (const [i, pr] of (menu.promos ?? []).entries()) {
    const text = typeof pr === 'string' ? pr
      : [pr?.name, pr?.title, pr?.description, pr?.text, pr?.code ? `Code: ${pr.code}` : ''].filter(Boolean).join(' — ');
    if (text) push(pr?.name || pr?.title || text, text, undefined, `promo:${pr?.id ?? i}`);
  }

  // 3) Tags whose code had no matching group (rare): only usable if the tag text itself has a value.
  const tagGroups = new Map<string, number[]>();
  for (const p of all) if (p.tag?.tagType === 'deal' && p.tag.text) tagGroups.set(p.tag.text, [...(tagGroups.get(p.tag.text) ?? []), p.id]);
  for (const [text, ids] of tagGroups) {
    const productIds = [...new Set(ids)].map((id) => products.get(id)?.id).filter((x): x is string => !!x);
    const covered = deals.some((d) => productIds.every((id) => d.appliesTo.productIds?.includes(id)));
    if (productIds.length && !covered) push(text, text, productIds, `tag:${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }

  return deals;
}

// ---------- fetching ----------

async function inPageJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
    return res.json();
  }, path) as Promise<T>;
}

async function passAgeGate(page: Page) {
  const yes = page.getByRole('button', { name: /^yes/i }).first();
  if (await yes.isVisible({ timeout: 4000 }).catch(() => false)) await yes.click().catch(() => {});
}

/** Fallback: type the address into the site's picker and capture the place + menu responses. */
async function viaUi(page: Page, area: SearchArea, log: (m: string) => void): Promise<{ place?: EazePlace; menu?: EazeMenu }> {
  log('falling back to address picker UI');
  let place: EazePlace | undefined;
  let menu: EazeMenu | undefined;
  const got = await captureJson(page, /\/api\/v1\/places\/|\/api\/v2\/menus\//, async () => {
    await page.locator('[data-e2eid=addressPicker]:visible').first().click({ timeout: 10000 });
    const box = page.locator('[data-e2eid=autoSuggestInput]').first();
    await box.click({ timeout: 10000 });
    await box.pressSequentially(`University City, San Diego, CA ${area.zip}`, { delay: 40 });
    await page.waitForTimeout(2500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForResponse((r) => /\/api\/v2\/menus\//.test(r.url()), { timeout: 30000 }).catch(() => {});
  }, 4000);
  for (const r of got) {
    if (/\/api\/v1\/places\//.test(r.url) && r.json?.depots) place = r.json;
    if (/\/api\/v2\/menus\//.test(r.url) && r.json?.groups) menu = r.json;
  }
  return { place, menu };
}

export const eazeAdapter: SourceAdapter = {
  id: 'eaze',
  enabled: () => config.sources.eaze,
  async fetchAll(area, log): Promise<SourceResult> {
    return withContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      await passAgeGate(page);
      await pause();

      let place: EazePlace | undefined;
      let menu: EazeMenu | undefined;
      try {
        const places = await inPageJson<EazePlace[]>(page, `/api/v1/places?query=${encodeURIComponent(area.zip)}&zipCode=true`);
        place = (places ?? []).find((p) => p.depots?.length && p.isAreaSupported !== false) ?? places?.[0];
        if (place?.depots?.length) {
          const menuSlug = place.menus?.[0] ?? place.depots.find((d) => d.primaryMenu)?.primaryMenu ?? 'default';
          await pause();
          menu = await inPageJson<EazeMenu>(page, `/api/v2/menus/${encodeURIComponent(menuSlug)}?place_id=${encodeURIComponent(place.id)}`);
        }
      } catch (e) {
        log(`direct API failed: ${(e as Error).message}`);
      }
      if (!place?.depots?.length || !menu?.groups) {
        const ui = await viaUi(page, area, log);
        place = ui.place ?? place;
        menu = ui.menu ?? menu;
      }
      if (!place?.depots?.length) {
        log(`no Eaze delivery for ZIP ${area.zip}`);
        return { stores: [], products: [], deals: [] };
      }
      if (!menu?.groups) throw new Error('Eaze menu not available (site changed or blocked)');

      // The menu is per place; the depot that fulfils it is the one whose primary menu matches.
      const menuSlug = menu.slug ?? place.menus?.[0] ?? 'default';
      const depots = place.depots.filter((d) => d.isEnabled !== false);
      const depot = depots.find((d) => d.primaryMenu === menuSlug) ?? depots[0] ?? place.depots[0];
      const store = mapStore(depot, place, area);
      log(`place ${place.zipCode ?? area.zip}: depot ${depot.id} "${depot.displayName ?? depot.name}" (${depots.length} depot(s)), ${menu.groups.length} groups`);

      const byEazeId = new Map<number, Product>();
      for (const g of menu.groups) {
        for (const p of g.products ?? []) {
          if (byEazeId.has(p.id)) continue;
          const mapped = mapProduct(p, store.id);
          if (mapped) byEazeId.set(p.id, mapped);
        }
      }
      const deals = buildDeals(menu, store.id, byEazeId);
      const pay = depot.depotPaymentSettings;
      if (pay?.minimumAmountBypassDeliveryFee) log(`delivery fee $${pay.deliveryFeeAmount} waived over $${pay.minimumAmountBypassDeliveryFee}`);
      return { stores: [store], products: [...byEazeId.values()], deals };
    });
  },
};
