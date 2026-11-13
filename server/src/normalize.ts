import type { Category, Deal, Product, Store } from '@gib/shared';
import type { SourceResult } from './sources/types.ts';
import { haversineMiles } from './pricing/engine.ts';

// ---------- product parsing helpers used by every adapter ----------

/** Map a source's category/type text to ours. */
export function mapCategory(...hints: (string | undefined | null)[]): Category {
  const s = hints.filter(Boolean).join(' ').toLowerCase();
  if (/pre[- ]?roll|preroll|joint|blunt|infused cone/.test(s)) return 'preroll';
  if (/vape|cart|cartridge|pod|disposable|510|all[- ]in[- ]one|aio/.test(s)) return 'vape';
  if (/concentrate|extract|wax|shatter|badder|batter|budder|rosin|resin|sauce|diamond|crumble|hash|kief|sugar|rso|dab/.test(s)) return 'concentrate';
  if (/edible|gumm|chocolate|beverage|drink|mint|candy|baked|cookie|chew|tablet|capsule/.test(s)) return 'edible';
  if (/flower|bud|eighth|shake|smalls|popcorn|ground/.test(s)) return 'flower';
  return 'other';
}

const FRACTION_GRAMS: [RegExp, number][] = [
  [/\b1\/8\s*(oz)?\b|\beighth\b/i, 3.5],
  [/\b1\/4\s*(oz)?\b|\bquarter\b/i, 7],
  [/\b1\/2\s*(oz)?\b|\bhalf\s*(oz|ounce)?\b/i, 14],
  [/\b1\s*oz\b|\bounce\b|\b28\s*g\b/i, 28],
];

/** Pull a net weight in grams out of strings like "3.5g", ".75g", "1/8 oz", "500mg cart", "1g x 5". */
export function parseGrams(...texts: (string | undefined | null)[]): number | undefined {
  const s = texts.filter(Boolean).join(' ');
  const pack = s.match(/(\d*\.?\d+)\s*g\b\s*[x×]\s*(\d+)|(\d+)\s*[x×]\s*(\d*\.?\d+)\s*g\b|(\d+)\s*pk.*?(\d*\.?\d+)\s*g\b/i);
  if (pack) {
    if (pack[1]) return round3(parseFloat(pack[1]) * parseInt(pack[2]));
    if (pack[3]) return round3(parseInt(pack[3]) * parseFloat(pack[4]));
    if (pack[5]) return round3(parseInt(pack[5]) * parseFloat(pack[6]));
  }
  const g = s.match(/(\d*\.?\d+)\s*(?:g|gr|gram|grams)\b/i);
  if (g) return parseFloat(g[1]);
  for (const [re, grams] of FRACTION_GRAMS) if (re.test(s)) return grams;
  const mg = s.match(/(\d*\.?\d+)\s*mg(?=\b|thc)/i);
  if (mg && /cart|vape|pod|disposable/i.test(s)) return parseFloat(mg[1]) / 1000; // 500mg cart = 0.5g oil
  return undefined;
}

/** THC mg for edibles: "100mg", "100mgTHC", "10mg x 10". */
export function parseThcMg(...texts: (string | undefined | null)[]): number | undefined {
  const s = texts.filter(Boolean).join(' ');
  const pack = s.match(/(\d*\.?\d+)\s*mg\s*[x×]\s*(\d+)|(\d+)\s*[x×]\s*(\d*\.?\d+)\s*mg/i);
  if (pack) return pack[1] ? parseFloat(pack[1]) * parseInt(pack[2]) : parseInt(pack[3]) * parseFloat(pack[4]);
  const mg = s.match(/(\d*\.?\d+)\s*mg(?=\b|thc)/i);
  return mg ? parseFloat(mg[1]) : undefined;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- cross-source merge ----------

const normName = (s: string) =>
  s.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(dispensary|cannabis|co|company|collective|the|inc|llc|san diego|sd|delivery|marijuana|weed|recreational|rec|med|medical)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

/** "8039 Balboa Ave # A" and "Wellgreens Kearny Mesa, 8039 Balboa Ave SUITE B" -> "8039 balboa". */
export function streetKey(address: string): string | null {
  const m = address.toLowerCase().match(/\b(\d{2,6})\s+(?:[nsew]\.?\s+)?([a-z]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Strip SEO junk some listings put in names: "Wellgreens - Kearny Mesa - Marijuana Weed Dispensary". */
export function cleanStoreName(name: string): string {
  return name
    .split(/\s+[-–|]\s+/)
    .filter((part, i) => i === 0 || !/^(recreational\s+)?(marijuana|weed|cannabis)(\s+(weed|marijuana|cannabis))*(\s+(dispensary|delivery|store))?$/i.test(part.trim()))
    .join(' - ')
    .trim();
}

/** Same physical store? Same street address within a mile, or same-ish name within ~1 mile (coords vary by source). */
export function sameStore(a: Store, b: Store): boolean {
  const miles = haversineMiles(a.lat, a.lng, b.lat, b.lng);
  const ka = streetKey(a.address), kb = streetKey(b.address);
  if (ka && kb && ka === kb && miles < 1) return true;
  const na = normName(a.name), nb = normName(b.name);
  const nameMatch = na.length > 2 && nb.length > 2 && (na === nb || na.includes(nb) || nb.includes(na));
  return nameMatch && miles < (na === nb ? 1.0 : 0.3);
}

const PREFERRED_SOURCE = ['dutchie', 'jane', 'weedmaps', 'eaze', 'sample'];

function mergeInto(target: Store, s: Store): Store {
  const delivery = [...target.delivery];
  for (const d of s.delivery) if (!delivery.some((x) => x.via === d.via)) delivery.push(d);
  const pick = <T>(a: T | null | undefined, b: T | null | undefined) => (a ?? b) as T;
  const betterAddr = !streetKey(target.address) && streetKey(s.address);
  return {
    ...target,
    ...(betterAddr ? { address: s.address, lat: s.lat, lng: s.lng, city: s.city || target.city } : {}),
    sources: [...target.sources, ...s.sources],
    pickup: target.pickup || s.pickup,
    menuUrl: target.menuUrl ?? s.menuUrl,
    website: target.website ?? s.website,
    phone: target.phone ?? s.phone,
    hours: target.hours ?? s.hours,
    // true wins (any source saying "tax included"/"own-site pickup" is a positive signal)
    taxIncluded: target.taxIncluded === true || s.taxIncluded === true ? true : pick(target.taxIncluded, s.taxIncluded),
    ownSitePickup: target.ownSitePickup === true || s.ownSitePickup === true ? true : pick(target.ownSitePickup, s.ownSitePickup),
    delivery,
  };
}

const productKey = (p: Product) => `${p.storeId}|${p.category}|${(p.brand ?? '').toLowerCase()}|${p.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${p.grams ?? ''}|${p.thcMg ?? ''}`;

/**
 * Combine results from all sources: one Store per physical location (with every delivery option),
 * products/deals re-pointed to the merged store, and duplicate products collapsed (cheapest listing kept).
 */
export function mergeResults(results: SourceResult[]): SourceResult {
  const allStores = results.flatMap((r) => r.stores).map((st) => ({ ...st, name: cleanStoreName(st.name) }))
    .sort((a, b) => PREFERRED_SOURCE.indexOf(a.sources[0]?.source) - PREFERRED_SOURCE.indexOf(b.sources[0]?.source));
  const merged: Store[] = [];
  const idMap = new Map<string, string>();
  for (const s of allStores) {
    const existing = merged.findIndex((m) => sameStore(m, s));
    if (existing >= 0) {
      merged[existing] = mergeInto(merged[existing], s);
      idMap.set(s.id, merged[existing].id);
    } else {
      merged.push(s);
      idMap.set(s.id, s.id);
    }
  }

  const products = new Map<string, Product>();
  for (const p0 of results.flatMap((r) => r.products)) {
    const p = { ...p0, storeId: idMap.get(p0.storeId) ?? p0.storeId };
    const key = productKey(p);
    const prev = products.get(key);
    const eff = (x: Product) => x.salePrice ?? x.price;
    if (!prev || eff(p) < eff(prev)) products.set(key, p);
  }

  const deals: Deal[] = results.flatMap((r) => r.deals).map((d) => ({ ...d, storeId: idMap.get(d.storeId) ?? d.storeId }));
  return { stores: merged, products: [...products.values()], deals };
}
