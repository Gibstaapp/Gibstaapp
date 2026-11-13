import type { Category, Deal, Product, Store } from '@gib/shared';
import type { SourceAdapter, SourceResult } from './types.ts';
import { config } from '../config.ts';

/**
 * Realistic but FAKE data (fictional stores in real San Diego neighborhoods).
 * Lets the UI + pricing be built and tested without hitting any live site. Turn off in config once real sources work.
 */

// Small deterministic PRNG so sample prices are stable between refreshes on the same day.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const STORES: Omit<Store, 'sources' | 'id'>[] = [
  { name: 'Golden Triangle Greens', address: '4400 La Jolla Village Dr', city: 'San Diego', lat: 32.8708, lng: -117.2108, pickup: true, ownSitePickup: true, taxIncluded: true, delivery: [{ via: 'weedmaps', fee: 5, minimum: 40, etaMinutes: 60 }], menuUrl: 'https://example.com/gtg' },
  { name: 'Sorrento Leaf Co.', address: '10150 Sorrento Valley Rd', city: 'San Diego', lat: 32.9006, lng: -117.2284, pickup: true, ownSitePickup: false, taxIncluded: false, delivery: [] },
  { name: 'Miramar Canopy', address: '7600 Miramar Rd', city: 'San Diego', lat: 32.8889, lng: -117.1426, pickup: true, ownSitePickup: true, taxIncluded: false, delivery: [{ via: 'eaze', fee: 3.99, minimum: 0, etaMinutes: 45 }, { via: 'weedmaps', fee: 0, minimum: 75 }], menuUrl: 'https://example.com/miramar' },
  { name: 'Kearny Mesa Botanicals', address: '4700 Convoy St', city: 'San Diego', lat: 32.8251, lng: -117.143, pickup: true, ownSitePickup: true, taxIncluded: true, delivery: [{ via: 'store', fee: 0, minimum: 50 }], menuUrl: 'https://example.com/kmb' },
  { name: 'Midway Harvest', address: '3500 Midway Dr', city: 'San Diego', lat: 32.753, lng: -117.205, pickup: true, ownSitePickup: false, taxIncluded: false, delivery: [{ via: 'eaze', fee: 4.99, minimum: 0 }] },
  { name: 'Chula Vista Cloud', address: '600 Broadway', city: 'Chula Vista', lat: 32.6401, lng: -117.0842, pickup: true, ownSitePickup: true, taxIncluded: false, delivery: [{ via: 'weedmaps', fee: 10, minimum: 50 }], menuUrl: 'https://example.com/cvc' },
  { name: 'La Mesa Lantern', address: '8300 La Mesa Blvd', city: 'La Mesa', lat: 32.7678, lng: -117.0231, pickup: true, ownSitePickup: null, taxIncluded: null, delivery: [] },
  { name: 'Lemon Grove Social', address: '7100 Broadway', city: 'Lemon Grove', lat: 32.7426, lng: -117.0314, pickup: true, ownSitePickup: true, taxIncluded: true, delivery: [] , menuUrl: 'https://example.com/lgs' },
  { name: 'Oceanside Tide', address: '1900 Oceanside Blvd', city: 'Oceanside', lat: 33.1959, lng: -117.3795, pickup: true, ownSitePickup: false, taxIncluded: false, delivery: [{ via: 'eaze', fee: 5.99, minimum: 0 }] },
  { name: 'Vista Ridge Wellness', address: '1300 E Vista Way', city: 'Vista', lat: 33.2, lng: -117.24, pickup: true, ownSitePickup: true, taxIncluded: false, delivery: [{ via: 'store', fee: 5, minimum: 60 }], menuUrl: 'https://example.com/vrw' },
];

// Fake hours too, so open / closed / "Hours not listed" all show up when testing.
const SAMPLE_HOURS: (string | undefined)[] = [
  'Mo-Su 08:00-22:00', 'Mo-Su 07:00-21:00', 'Mo-Th 09:00-21:00; Fr,Sa 09:00-23:00; Su 10:00-20:00', 'Mo-Su 06:00-24:00', undefined,
];

interface Template { name: string; brand: string; cat: Category; grams?: number; thcMg?: number; base: number; thc?: number }
const TEMPLATES: Template[] = [
  { name: 'Blue Dream 3.5g', brand: 'Pacific Stone', cat: 'flower', grams: 3.5, base: 25, thc: 24 },
  { name: 'Gelato #41 3.5g', brand: 'Cookies', cat: 'flower', grams: 3.5, base: 50, thc: 29 },
  { name: 'Wedding Cake 7g', brand: 'Glass House', cat: 'flower', grams: 7, base: 40, thc: 26 },
  { name: 'House Smalls 14g', brand: 'Pacific Stone', cat: 'flower', grams: 14, base: 55, thc: 22 },
  { name: 'Sour Diesel 28g', brand: 'Glass House', cat: 'flower', grams: 28, base: 110, thc: 23 },
  { name: 'OG Kush Pre-roll 1g', brand: 'Pacific Stone', cat: 'preroll', grams: 1, base: 8, thc: 23 },
  { name: 'Mini Dogwalkers 5pk 0.35g', brand: 'Dogwalkers', cat: 'preroll', grams: 1.75, base: 25, thc: 25 },
  { name: 'Infused Pre-roll 1g', brand: 'Jeeter', cat: 'preroll', grams: 1, base: 18, thc: 35 },
  { name: 'Live Resin Cart 1g', brand: 'Raw Garden', cat: 'vape', grams: 1, base: 45, thc: 82 },
  { name: 'OG Pod 1g', brand: 'Stiiizy', cat: 'vape', grams: 1, base: 40, thc: 85 },
  { name: 'Disposable 0.5g', brand: 'Plug Play', cat: 'vape', grams: 0.5, base: 30, thc: 80 },
  { name: 'Distillate Cart 1g', brand: 'Heavy Hitters', cat: 'vape', grams: 1, base: 35, thc: 90 },
  { name: 'Live Resin Badder 1g', brand: 'Cream of the Crop', cat: 'concentrate', grams: 1, base: 30, thc: 78 },
  { name: 'Cold Cure Rosin 1g', brand: 'Kalya', cat: 'concentrate', grams: 1, base: 60, thc: 72 },
  { name: 'Diamonds 1g', brand: 'Stiiizy', cat: 'concentrate', grams: 1, base: 40, thc: 90 },
  { name: 'Sour Gummies 100mg', brand: 'Kiva', cat: 'edible', thcMg: 100, base: 20 },
  { name: 'Wyld Gummies 10mg x 10', brand: 'Wyld', cat: 'edible', thcMg: 100, base: 18 },
  { name: 'Chocolate Bar 100mg', brand: 'Kiva', cat: 'edible', thcMg: 100, base: 22 },
  { name: 'THC Seltzer 10mg', brand: 'Cann', cat: 'edible', thcMg: 10, base: 6 },
  { name: 'Tincture 1000mg', brand: 'Papa & Barkley', cat: 'other', thcMg: 1000, base: 60 },
  { name: 'Releaf Balm', brand: 'Papa & Barkley', cat: 'other', base: 35 },
];

export const sampleAdapter: SourceAdapter = {
  id: 'sample',
  states: ['CA'], // fake San Diego stores
  enabled: () => config.sources.sample,
  async fetchAll(): Promise<SourceResult> {
    const today = new Date();
    const r = rng(today.getFullYear() * 1000 + today.getMonth() * 40 + today.getDate());
    const stores: Store[] = [];
    const products: Product[] = [];
    const deals: Deal[] = [];

    STORES.forEach((s, i) => {
      const id = `sample:${i}`;
      stores.push({ ...s, id, hours: SAMPLE_HOURS[i % SAMPLE_HOURS.length], sources: [{ source: 'sample', externalId: String(i) }] });

      // Tax-included stores price a bit higher on the shelf.
      const markup = s.taxIncluded ? 1.25 : 1;
      for (const t of TEMPLATES) {
        if (r() < 0.2) continue; // not every store carries everything
        const price = Math.round(t.base * markup * (0.8 + r() * 0.45));
        const pid = `${id}:${t.name}`;
        const onSale = r() < 0.12;
        products.push({
          id: pid, storeId: id, source: 'sample', name: t.name, brand: t.brand, category: t.cat,
          grams: t.grams, thcMg: t.thcMg, thcPct: t.thc, price: Math.round(price * 100) / 100,
          ...(onSale ? { salePrice: Math.round(price * 0.75), saleLabel: 'Manager special' } : {}),
        });
      }

      const d = (x: Partial<Deal> & Pick<Deal, 'title' | 'kind'>): Deal => ({ id: `${id}:${deals.length}`, storeId: id, source: 'sample', audience: 'everyone', appliesTo: {}, conditions: {}, ...x });
      // First-time deal: almost every SD shop has one.
      const ftPct = [20, 25, 30, 40, 50][Math.floor(r() * 5)];
      deals.push(d({ title: `${ftPct}% off your first order`, kind: 'percent', value: ftPct, audience: 'first_time', conditions: { limitPerCustomer: 1 }, finePrint: 'New customers only. Excludes accessories. Cannot be combined with other offers.' }));
      deals.push(d({ title: 'Veteran discount', kind: 'percent', value: 10 + Math.floor(r() * 3) * 5, audience: 'veteran', conditions: { idRequired: true } }));
      deals.push(d({ title: 'Senior discount', kind: 'percent', value: 10, audience: 'senior', conditions: { idRequired: true } }));
      if (r() < 0.5) deals.push(d({ title: 'Student discount', kind: 'percent', value: 10, audience: 'student', conditions: { idRequired: true } }));

      const dailies: Partial<Deal>[] = [
        { title: 'Munchie Monday', days: [1], appliesTo: { categories: ['edible'] }, value: 25 },
        { title: 'Toke Tuesday', days: [2], appliesTo: { categories: ['preroll'] }, value: 20 },
        { title: 'Wax Wednesday', days: [3], appliesTo: { categories: ['concentrate'] }, value: 30 },
        { title: 'Thirsty Thursday', days: [4], appliesTo: { categories: ['vape'] }, value: 20 },
        { title: 'Flower Friday', days: [5], appliesTo: { categories: ['flower'] }, value: 25 },
        { title: 'Weekend 15% off', days: [0, 6], appliesTo: {}, value: 15 },
      ];
      for (const x of dailies) {
        if (r() < 0.55) deals.push(d({ ...x, title: x.title!, kind: 'percent', stackable: r() < 0.6, finePrint: r() < 0.4 ? 'Excludes Stiiizy and Raw Garden.' : undefined, appliesTo: { ...x.appliesTo, ...(r() < 0.4 ? { excludeBrands: ['Stiiizy', 'Raw Garden'] } : {}) } }));
      }
      if (r() < 0.5) deals.push(d({ title: '2 for $50 Cookies eighths', kind: 'bundle', bundleQty: 2, bundlePrice: 50, appliesTo: { brands: ['Cookies'], categories: ['flower'] } }));
      if (r() < 0.5) deals.push(d({ title: 'BOGO 50% off carts', kind: 'bogo', bogoBuy: 1, bogoGetPct: 50, appliesTo: { categories: ['vape'] }, finePrint: 'Equal or lesser value. While supplies last.' }));
      if (r() < 0.4) deals.push(d({ title: 'Kiva $5 off', kind: 'amount', value: 5, appliesTo: { brands: ['Kiva'] }, conditions: { expiresAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59).toISOString() } }));
      if (r() < 0.3) deals.push(d({ title: 'In-store: $99 ounces', kind: 'fixed', value: 99, appliesTo: { categories: ['flower'], minGrams: 28 }, conditions: { inStoreOnly: true, cashOnly: r() < 0.5 } }));
    });
    return { stores, products, deals };
  },
};
