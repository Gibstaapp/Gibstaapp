/**
 * Build the data files for the always-on website (GitHub Pages).
 *
 *   GIB_DB=/tmp/snap.db PREV_URL=https://andysteiner778.github.io/Gibstaapp npx tsx src/export-static.ts ../web/dist/data
 *
 * 1. Loads the previous snapshot from the live site, so a source that fails today keeps yesterday's data.
 * 2. Runs the normal weed refresh (all enabled sources) and the beer refresh for the home area.
 * 3. Writes weed.json / beer.json / meta.json. Products are trimmed to the cheapest ones per
 *    store + category so phones download ~1-2 MB, not 100k items. Pricing (deals, taxes,
 *    veteran/student, "I've been here") still runs on the phone, per person.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BeerPrice, BeerVenue, Deal, HappyHour, Product, RefreshStatus, Store } from '@gib/shared';
import { beerRepo, repo, DEFAULT_PROFILE } from './db.ts';
import { config } from './config.ts';
import { refreshAll } from './refresh.ts';
import { refreshBeer } from './beer/refresh.ts';
import { rankItems } from './pricing/engine.ts';
import './sources/register.ts';

export interface WeedSnapshot { stores: Store[]; products: Product[]; deals: Deal[]; status: RefreshStatus }
export interface BeerSnapshot { venues: BeerVenue[]; prices: BeerPrice[]; happyHours: HappyHour[]; status: RefreshStatus; area: { lat: number; lng: number; miles: number } }

const outDir = resolve(process.argv[2] ?? 'static-data');
const KEEP_PER_STORE_CATEGORY = 60;

async function loadPrevious() {
  const base = process.env.PREV_URL?.replace(/\/+$/, '');
  if (!base) return;
  try {
    const [w, b] = await Promise.all([
      fetch(`${base}/data/weed.json`).then((r) => (r.ok ? r.json() as Promise<WeedSnapshot> : null)),
      fetch(`${base}/data/beer.json`).then((r) => (r.ok ? r.json() as Promise<BeerSnapshot> : null)),
    ]);
    if (w) { repo.replaceCatalog(w.stores, w.products, w.deals); repo.setRefreshStatus(w.status); console.log(`[export] previous weed: ${w.products.length} products`); }
    if (b) {
      beerRepo.upsertVenues(b.venues);
      beerRepo.replaceWebsiteFor(b.venues.map((v) => v.id), b.prices.filter((p) => p.source === 'website'), b.happyHours);
      console.log(`[export] previous beer: ${b.venues.length} places`);
    }
  } catch (e) {
    console.warn('[export] no previous snapshot:', (e as Error).message);
  }
}

function trimProducts(stores: Store[], products: Product[], deals: Deal[]): Product[] {
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const keep = new Set<string>();
  for (const mode of ['pickup', 'delivery'] as const) {
    const ranked = rankItems(products, storeMap, deals, new Map(), DEFAULT_PROFILE, { mode });
    const count = new Map<string, number>();
    for (const it of ranked) {
      const key = `${it.store.id}|${it.product.category}`;
      const n = count.get(key) ?? 0;
      if (n >= KEEP_PER_STORE_CATEGORY) continue;
      count.set(key, n + 1);
      keep.add(it.product.id);
    }
  }
  return products.filter((p) => keep.has(p.id));
}

await loadPrevious();
console.log('[export] sources:', Object.entries(config.sources).filter(([, on]) => on).map(([k]) => k).join(', '));
// SKIP_REFRESH=1: just export what's in the database (for testing).
const [weedStatus] = process.env.SKIP_REFRESH ? [repo.refreshStatus()] : await Promise.all([
  refreshAll(),
  refreshBeer({ forceOsm: true }).catch((e) => console.error('[export] beer', e)),
]);

const stores = repo.stores(), deals = repo.deals();
const products = trimProducts(stores, repo.products(), deals);
const usedStores = new Set(products.map((p) => p.storeId));
const weed: WeedSnapshot = {
  stores: stores.filter((s) => usedStores.has(s.id)),
  products,
  deals: deals.filter((d) => usedStores.has(d.storeId)),
  status: weedStatus,
};
const home = DEFAULT_PROFILE;
const beer: BeerSnapshot = {
  venues: beerRepo.venues(),
  prices: beerRepo.prices().filter((p) => p.source !== 'user'),
  happyHours: beerRepo.happyHours(),
  status: beerRepo.status(),
  area: { lat: home.lat, lng: home.lng, miles: 25 },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'weed.json'), JSON.stringify(weed));
writeFileSync(resolve(outDir, 'beer.json'), JSON.stringify(beer));
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify({ builtAt: new Date().toISOString(), weed: weedStatus, beer: beer.status }));
console.log(`[export] wrote ${outDir}: ${weed.stores.length} stores, ${weed.products.length} products, ${beer.venues.length} beer places, ${beer.prices.length} beer prices`);
process.exit(0);
