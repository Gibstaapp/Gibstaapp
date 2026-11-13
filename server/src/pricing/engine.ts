import { MAX_RESULT_MILES } from '@gib/shared';
import type { Category, Deal, DeliveryOption, Mode, OpenStatus, PricedItem, Product, Store, StoreOverride, UserProfile } from '@gib/shared';
import { bestDeal, finePrintFor } from './deals.ts';
import { computeTax } from './taxes.ts';
import { openState, wallClockIn, STORE_TIME_ZONE } from '../hours.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Store with the user's overrides applied. */
export function effectiveStore(store: Store, override?: StoreOverride): Store {
  if (!override) return store;
  return {
    ...store,
    taxIncluded: override.taxIncluded !== undefined ? override.taxIncluded : store.taxIncluded,
    ownSitePickup: override.ownSitePickup !== undefined ? override.ownSitePickup : store.ownSitePickup,
  };
}

/** Price per gram for weight-based categories; per 100mg THC for edibles/tinctures. */
export function perUnitPrice(p: Product, otd: number): { perUnit: number; unitLabel: PricedItem['unitLabel'] } {
  const thcBased = p.category === 'edible' || (p.category === 'other' && p.thcMg);
  if (thcBased && p.thcMg) return { perUnit: round2((otd / p.thcMg) * 100), unitLabel: '/100mg' };
  if (p.grams && p.grams > 0) return { perUnit: round2(otd / p.grams), unitLabel: '/g' };
  return { perUnit: round2(otd), unitLabel: '/ea' };
}

function cheapestDelivery(opts: DeliveryOption[]): DeliveryOption | undefined {
  return [...opts].sort((a, b) => a.fee - b.fee || a.minimum - b.minimum)[0];
}

export interface PriceOptions {
  mode: Mode;
  now?: Date;
  /** The store's open status, if the caller already worked it out (saves re-parsing hours per product). */
  open?: OpenStatus;
}

/** Price one product for this user. Returns null when the store can't serve the requested mode. */
export function priceItem(product: Product, rawStore: Store, deals: Deal[], profile: UserProfile, opts: PriceOptions, override?: StoreOverride): PricedItem | null {
  const store = effectiveStore(rawStore, override);
  const now = opts.now ?? new Date();
  const mode = opts.mode;

  let delivery: DeliveryOption | undefined;
  if (mode === 'pickup' && !store.pickup) return null;
  if (mode === 'delivery') {
    delivery = cheapestDelivery(store.delivery);
    if (!delivery) return null;
  }
  const deliveryFee = delivery?.fee ?? 0;
  const ctx = { now, mode };

  const calc = (includeFirstTime: boolean) => {
    const { applied, used } = bestDeal(product, deals, profile, ctx, includeFirstTime);
    const priceAfterDeals = applied?.effectiveUnitPrice ?? product.price;
    const tax = computeTax(priceAfterDeals, store.city, deliveryFee, store.taxIncluded);
    const otd = round2(priceAfterDeals + deliveryFee + tax.total);
    return { applied, used, priceAfterDeals, tax, otd };
  };

  const best = calc(true);
  const usesFirstTime = !!best.used.some((d) => d.audience === 'first_time');
  const regular = usesFirstTime ? calc(false) : undefined;

  const { perUnit, unitLabel } = perUnitPrice(product, best.otd);
  return {
    product,
    store,
    mode,
    deliveryVia: delivery?.via,
    listPrice: product.price,
    deal: best.applied,
    usesFirstTime,
    regularOtd: regular?.otd,
    regularDeal: regular?.applied,
    priceAfterDeals: best.priceAfterDeals,
    tax: best.tax,
    deliveryFee,
    deliveryMinimum: delivery?.minimum,
    otd: best.otd,
    perUnit,
    unitLabel,
    distanceMiles: round2(haversineMiles(profile.lat, profile.lng, store.lat, store.lng)),
    open: opts.open ?? openState(store.hours, wallClockIn(STORE_TIME_ZONE, now)),
    finePrint: finePrintFor(best.used, product.price, now),
  };
}

export interface RankQuery {
  category?: Category;
  mode: Mode;
  maxMiles?: number;
  search?: string;
  limit?: number;
  now?: Date;
  /** Hide stores we know are closed right now. Stores with unknown hours stay (labelled "Hours not listed"). */
  openNow?: boolean;
}

/** Price everything and sort cheapest-per-unit first. */
export function rankItems(
  products: Product[],
  stores: Map<string, Store>,
  deals: Deal[],
  overrides: Map<string, StoreOverride>,
  profile: UserProfile,
  q: RankQuery,
): PricedItem[] {
  const dealsByStore = new Map<string, Deal[]>();
  for (const d of deals) {
    const arr = dealsByStore.get(d.storeId) ?? [];
    arr.push(d);
    dealsByStore.set(d.storeId, arr);
  }
  const search = q.search?.toLowerCase().trim();
  const now = q.now ?? new Date();
  const openByStore = new Map<string, OpenStatus>();
  const out: PricedItem[] = [];
  for (const p of products) {
    if (q.category && p.category !== q.category) continue;
    if (search && !`${p.name} ${p.brand ?? ''}`.toLowerCase().includes(search)) continue;
    const store = stores.get(p.storeId);
    if (!store) continue;
    const ov = overrides.get(store.id);
    if (ov?.hidden) continue;
    let open = openByStore.get(store.id);
    // Store hours are San Diego time, wherever the phone is.
    if (!open) openByStore.set(store.id, (open = openState(store.hours, wallClockIn(STORE_TIME_ZONE, now))));
    if (q.openNow && open.isOpen === false) continue;
    const item = priceItem(p, store, dealsByStore.get(store.id) ?? [], profile, { mode: q.mode, now, open }, ov);
    if (!item) continue;
    if (q.maxMiles != null && q.mode === 'pickup' && item.distanceMiles > q.maxMiles) continue;
    if (item.distanceMiles > MAX_RESULT_MILES) continue; // never more than 100 mi from the home area code
    // Delivery zones were worked out for San Diego: a store this far from home doesn't deliver to you.
    if (q.mode === 'delivery' && item.distanceMiles > DELIVERY_MAX_MILES) continue;
    out.push(item);
  }
  // Items with no weight/mg ("/ea") can't be compared per gram: rank them after everything that can.
  out.sort((a, b) => Number(a.unitLabel === '/ea') - Number(b.unitLabel === '/ea') || a.perUnit - b.perUnit || a.otd - b.otd);
  const featured = q.mode === 'pickup' ? findCloserPicks(out) : [];
  const rest = out.filter((i) => !featured.includes(i));
  const ranked = [...featured, ...rest];
  return q.limit ? ranked.slice(0, q.limit) : ranked;
}

export const DELIVERY_MAX_MILES = 60;
export const CLOSER_MIN_MILES = 5;
export const CLOSER_MAX_EXTRA = 10;
export const CLOSER_MAX_PICKS = 5;

/** Same category + same size, so we only compare like with like (eighth vs eighth). */
const sizeKey = (p: Product) =>
  `${p.category}|${p.thcMg && (p.category === 'edible' || p.category === 'other') ? `${p.thcMg}mg` : p.grams ? `${Math.round(p.grams * 10) / 10}g` : 'ea'}`;

/**
 * "Closer picks": within each size, an item at least CLOSER_MIN_MILES closer than the cheapest option
 * and no more than CLOSER_MAX_EXTRA dollars more out the door. Best one per size; marks items in place.
 */
export function findCloserPicks(items: PricedItem[]): PricedItem[] {
  const groups = new Map<string, PricedItem[]>();
  for (const it of items) {
    if (it.unitLabel === '/ea') continue; // unknown size: can't compare like with like
    const k = sizeKey(it.product);
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }
  const picks: PricedItem[] = [];
  for (const group of groups.values()) {
    const cheapest = group.reduce((a, b) => (b.otd < a.otd || (b.otd === a.otd && b.distanceMiles < a.distanceMiles) ? b : a));
    let best: PricedItem | undefined;
    for (const it of group) {
      if (it === cheapest || it.store.id === cheapest.store.id) continue;
      const milesCloser = cheapest.distanceMiles - it.distanceMiles;
      const extra = it.otd - cheapest.otd;
      if (milesCloser < CLOSER_MIN_MILES || extra > CLOSER_MAX_EXTRA) continue;
      if (!best || it.otd < best.otd || (it.otd === best.otd && it.distanceMiles < best.distanceMiles)) best = it;
    }
    if (best) {
      best.closerPick = {
        milesCloser: round2(cheapest.distanceMiles - best.distanceMiles),
        extraCost: round2(Math.max(0, best.otd - cheapest.otd)),
        vsStore: cheapest.store.name,
        vsOtd: cheapest.otd,
        vsMiles: cheapest.distanceMiles,
      };
      picks.push(best);
    }
  }
  // Best value first.
  picks.sort((a, b) => a.perUnit - b.perUnit || a.otd - b.otd);
  const kept = picks.slice(0, CLOSER_MAX_PICKS);
  for (const p of picks.slice(CLOSER_MAX_PICKS)) delete p.closerPick;
  return kept;
}
