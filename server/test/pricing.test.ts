import { describe, expect, it } from 'vitest';
import type { Deal, Product, Store, UserProfile } from '@gib/shared';
import { computeTax } from '../src/pricing/taxes.ts';
import { applyDeal, finePrintFor } from '../src/pricing/deals.ts';
import { priceItem, rankItems } from '../src/pricing/engine.ts';

const WED = new Date('2026-11-11T12:00:00'); // Wednesday
const THU = new Date('2026-11-12T12:00:00');

const profile = (p: Partial<UserProfile> = {}): UserProfile => ({
  homeZip: '92122', lat: 32.8566, lng: -117.2091, radiusMiles: 25,
  veteran: false, senior: false, student: false, visitedStoreIds: [], onboarded: true, notifyHour: 7, ...p,
});

const store = (s: Partial<Store> = {}): Store => ({
  id: 's1', name: 'Test Dispo', address: '1 Main', city: 'San Diego', lat: 32.88, lng: -117.2,
  sources: [], pickup: true, ownSitePickup: true, taxIncluded: false, delivery: [], ...s,
});

const product = (p: Partial<Product> = {}): Product => ({
  id: 'p1', storeId: 's1', source: 'sample', name: 'Blue Dream 3.5g', brand: 'Acme', category: 'flower', grams: 3.5, price: 40, ...p,
});

const deal = (d: Partial<Deal>): Deal => ({
  id: 'd1', storeId: 's1', source: 'sample', title: 'Deal', kind: 'percent', value: 0, audience: 'everyone', appliesTo: {}, conditions: {}, ...d,
});

describe('taxes', () => {
  it('San Diego city stack: local 10% -> excise 15% of base -> sales 7.75% of base+excise', () => {
    const t = computeTax(35, 'San Diego');
    expect(t.local).toBe(3.5);
    expect(t.excise).toBe(5.78);   // 0.15 * 38.5 = 5.775
    expect(t.sales).toBe(3.43);    // 0.0775 * 44.275 = 3.431
    expect(t.total).toBe(12.71);
  });
  it('matches the CDTFA worked example for excise (delivery fee is in the base)', () => {
    // $35 + $3.50 local + $5 delivery = $43.50 base; 15% = $6.53
    expect(computeTax(35, 'San Diego', 5).excise).toBe(6.53);
  });
  it('tax-included store adds nothing', () => {
    const t = computeTax(35, 'San Diego', 0, true);
    expect(t.total).toBe(0);
    expect(t.included).toBe(true);
  });
  it('unknown city falls back to county default', () => {
    expect(computeTax(100, 'Nowhere').estimated).toBe(true);
  });
});

describe('deal math', () => {
  it('percent', () => expect(applyDeal(deal({ kind: 'percent', value: 25 }), 40).unit).toBe(30));
  it('amount', () => expect(applyDeal(deal({ kind: 'amount', value: 5 }), 40).unit).toBe(35));
  it('fixed', () => expect(applyDeal(deal({ kind: 'fixed', value: 25 }), 40).unit).toBe(25));
  it('bundle 3 for $60', () => expect(applyDeal(deal({ kind: 'bundle', bundleQty: 3, bundlePrice: 60 }), 25)).toEqual({ unit: 20, requiresQty: 3 }));
  it('bundle that is worse than list is ignored', () => expect(applyDeal(deal({ kind: 'bundle', bundleQty: 2, bundlePrice: 60 }), 25).unit).toBe(25));
  it('BOGO 50%', () => expect(applyDeal(deal({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50 }), 40)).toEqual({ unit: 30, requiresQty: 2 }));
  it('BOGO free', () => expect(applyDeal(deal({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 100 }), 40).unit).toBe(20));
});

describe('engine', () => {
  const taxFree = store({ taxIncluded: true });

  it('first-time deal wins until the store is marked visited', () => {
    const deals = [deal({ id: 'ft', title: '40% off first order', value: 40, audience: 'first_time' }), deal({ id: 'd', value: 10 })];
    const fresh = priceItem(product(), taxFree, deals, profile(), { mode: 'pickup', now: THU })!;
    expect(fresh.otd).toBe(24);
    expect(fresh.usesFirstTime).toBe(true);
    expect(fresh.regularOtd).toBe(36);
    expect(fresh.finePrint[0]).toEqual({ text: 'First-time customers only', important: true });

    const visited = priceItem(product(), taxFree, deals, profile({ visitedStoreIds: ['s1'] }), { mode: 'pickup', now: THU })!;
    expect(visited.otd).toBe(36);
    expect(visited.usesFirstTime).toBe(false);
  });

  it('veteran discount stacks on a stackable daily deal', () => {
    const deals = [deal({ id: 'd', title: 'Flower Day', value: 20, stackable: true }), deal({ id: 'v', title: 'Veteran 10%', value: 10, audience: 'veteran' })];
    const r = priceItem(product(), taxFree, deals, profile({ veteran: true, visitedStoreIds: ['s1'] }), { mode: 'pickup', now: THU })!;
    expect(r.otd).toBe(28.8); // 40 * 0.8 * 0.9
    expect(r.deal!.title).toBe('Flower Day + Veteran 10%');
  });

  it('veteran discount is not offered to non-veterans', () => {
    const deals = [deal({ id: 'v', title: 'Veteran 10%', value: 10, audience: 'veteran' })];
    expect(priceItem(product(), taxFree, deals, profile(), { mode: 'pickup', now: THU })!.otd).toBe(40);
  });

  it('day-of-week deals only apply on their day', () => {
    const deals = [deal({ title: 'Wax Wednesday', value: 25, days: [3], appliesTo: { categories: ['concentrate'] } })];
    const wax = product({ category: 'concentrate', grams: 1, price: 40 });
    expect(priceItem(wax, taxFree, deals, profile(), { mode: 'pickup', now: WED })!.otd).toBe(30);
    expect(priceItem(wax, taxFree, deals, profile(), { mode: 'pickup', now: THU })!.otd).toBe(40);
  });

  it('brand exclusions are respected', () => {
    const deals = [deal({ value: 20, appliesTo: { excludeBrands: ['acme'] } })];
    expect(priceItem(product(), taxFree, deals, profile(), { mode: 'pickup', now: THU })!.otd).toBe(40);
  });

  it('delivery adds the cheapest fee, and the fee is taxed', () => {
    const s = store({ delivery: [{ via: 'eaze', fee: 5, minimum: 50 }, { via: 'weedmaps', fee: 7, minimum: 0 }] });
    const r = priceItem(product({ price: 35 }), s, [], profile(), { mode: 'delivery', now: THU })!;
    expect(r.deliveryVia).toBe('eaze');
    expect(r.tax.excise).toBe(6.53);
    expect(r.otd).toBe(round(35 + 5 + r.tax.total));
  });

  it('pickup-only deals are skipped for delivery', () => {
    const s = store({ taxIncluded: true, delivery: [{ via: 'store', fee: 0, minimum: 0 }] });
    const deals = [deal({ value: 50, conditions: { pickupOnly: true } })];
    expect(priceItem(product(), s, deals, profile(), { mode: 'delivery', now: THU })!.otd).toBe(40);
    expect(priceItem(product(), s, deals, profile(), { mode: 'pickup', now: THU })!.otd).toBe(20);
  });

  it('stores without delivery are excluded from delivery mode', () => {
    expect(priceItem(product(), store(), [], profile(), { mode: 'delivery', now: THU })).toBeNull();
  });

  it('$/g lets an ounce beat an eighth', () => {
    const eighth = product({ id: 'e', price: 25, grams: 3.5 });
    const oz = product({ id: 'o', price: 120, grams: 28 });
    const ranked = rankItems([eighth, oz], new Map([['s1', taxFree]]), [], new Map(), profile(), { mode: 'pickup', now: THU });
    expect(ranked.map((r) => r.product.id)).toEqual(['o', 'e']);
    expect(ranked[0].perUnit).toBe(4.29);
    expect(ranked[0].unitLabel).toBe('/g');
  });

  it('edibles rank by $/100mg THC', () => {
    const gummies = product({ category: 'edible', grams: undefined, thcMg: 100, price: 20 });
    const r = priceItem(gummies, taxFree, [], profile(), { mode: 'pickup', now: THU })!;
    expect(r.perUnit).toBe(20);
    expect(r.unitLabel).toBe('/100mg');
  });

  it('store overrides beat auto-detected values', () => {
    const r = priceItem(product(), store({ taxIncluded: false }), [], profile(), { mode: 'pickup', now: THU }, { storeId: 's1', taxIncluded: true });
    expect(r!.otd).toBe(40);
  });
});

describe('fine print', () => {
  it('flags risky text and same-day expiry as important', () => {
    const d = deal({ finePrint: 'Excludes Stiiizy. While supplies last. Good on all flower.', conditions: { expiresAt: '2026-11-12T23:59:00', limitPerCustomer: 2 } });
    const fp = finePrintFor([d], 40, THU);
    const important = fp.filter((f) => f.important).map((f) => f.text);
    expect(important).toContain('Ends today');
    expect(important).toContain('Limit 2 per customer');
    expect(important).toContain('Excludes Stiiizy.');
    expect(important).toContain('While supplies last.');
    expect(fp.find((f) => f.text === 'Good on all flower.')!.important).toBe(false);
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }

import { isStaleHolidayDeal } from '../src/sanitize.ts';
describe('sanitize', () => {
  it("drops Mother's Day deals in November but keeps them in May", () => {
    const d = deal({ title: 'Mother’s Day 40% Off' });
    expect(isStaleHolidayDeal(d, new Date('2026-11-12'))).toBe(true);
    expect(isStaleHolidayDeal(d, new Date('2026-05-08'))).toBe(false);
    expect(isStaleHolidayDeal(deal({ title: 'Black Friday 30%' }), new Date('2026-11-12'))).toBe(false);
    expect(isStaleHolidayDeal(deal({ title: 'Wax Wednesday' }), new Date('2026-11-12'))).toBe(false);
  });
});

describe('closer picks', () => {
  const far = store({ id: 'far', name: 'Far Dispo', taxIncluded: true, lat: 33.2, lng: -117.38 });   // ~25 mi from 92122
  const near = store({ id: 'near', name: 'Near Dispo', taxIncluded: true, lat: 32.87, lng: -117.21 }); // ~1 mi
  const mid = store({ id: 'mid', name: 'Pricey Near', taxIncluded: true, lat: 32.86, lng: -117.2 });
  const stores = new Map([['far', far], ['near', near], ['mid', mid]]);
  const p = (id: string, storeId: string, price: number, grams = 3.5) => product({ id, storeId, price, grams });

  it('pins a ≥5 mi closer, ≤$10 pricier same-size item to the top', () => {
    const items = rankItems([p('a', 'far', 20), p('b', 'near', 28), p('c', 'mid', 40)], stores, [], new Map(), profile(), { mode: 'pickup', now: THU });
    expect(items[0].product.id).toBe('b');
    expect(items[0].closerPick).toMatchObject({ extraCost: 8, vsStore: 'Far Dispo' });
    expect(items[1].product.id).toBe('a');
    expect(items.find((i) => i.product.id === 'c')!.closerPick).toBeUndefined();
  });

  it('no pick when the closer one costs more than $10 extra', () => {
    const items = rankItems([p('a', 'far', 20), p('b', 'near', 31)], stores, [], new Map(), profile(), { mode: 'pickup', now: THU });
    expect(items[0].product.id).toBe('a');
    expect(items.some((i) => i.closerPick)).toBe(false);
  });

  it('only compares the same size', () => {
    const items = rankItems([p('oz', 'far', 90, 28), p('e', 'near', 30, 3.5)], stores, [], new Map(), profile(), { mode: 'pickup', now: THU });
    expect(items.some((i) => i.closerPick)).toBe(false);
  });

  it('never applies to delivery', () => {
    const d = (s: Store) => ({ ...s, delivery: [{ via: 'store' as const, fee: 0, minimum: 0 }] });
    const ds = new Map([['far', d(far)], ['near', d(near)]]);
    const items = rankItems([p('a', 'far', 20), p('b', 'near', 28)], ds, [], new Map(), profile(), { mode: 'delivery', now: THU });
    expect(items.some((i) => i.closerPick)).toBe(false);
  });
});

import { sanitize } from '../src/sanitize.ts';
describe('recategorize topicals', () => {
  it('moves topicals out of concentrates, leaves strains alone', () => {
    const r = sanitize([
      product({ id: 't', category: 'concentrate', name: "Mary's Medicinals TD Compound", grams: 28, price: 60 }),
      product({ id: 'c', category: 'flower', name: 'Ice Cream Cake 3.5g', price: 30 }),
    ], [], () => {});
    expect(r.products.find((p) => p.id === 't')!.category).toBe('other');
    expect(r.products.find((p) => p.id === 'c')!.category).toBe('flower');
  });
});
