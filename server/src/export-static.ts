/**
 * Build the data files for the always-on website (GitHub Pages).
 *
 *   GIB_DB=/tmp/snap.db PREV_URL=https://<github-owner>.github.io/Gibstaapp npx tsx src/export-static.ts ../web/dist/data
 *
 * Each city is its own refresh; the others keep the data they have:
 *   REFRESH=sandiego  San Diego weed + beer (dollars)
 *   REFRESH=newyork   New York weed + beer (dollars)
 *   REFRESH=athens    Athens beer (euros)
 *   (unset)           all three, one city after another
 * SKIP_REFRESH=1: no refreshes at all, just merge what's there (deploys after a code change).
 *
 * 1. Loads the previous snapshot from the live site, so a source that fails today keeps yesterday's data.
 * 2. Runs the normal weed refresh (all enabled sources) and the beer refresh for the home area.
 * 3. Writes weed.json / beer.json / meta.json. Products are trimmed to the cheapest ones per
 *    store + category so phones download ~1-2 MB, not 100k items. Pricing (deals, taxes,
 *    veteran/student, "I've been here") still runs on the phone, per person.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REGIONS, WEED_FILES, regionAt, type RegionId, type BeerPrice, type BeerVenue, type Deal, type HappyHour, type Product, type RefreshStatus, type Store } from '@gib/shared';
import { beerRepo, repo, DEFAULT_PROFILE } from './db.ts';
import { config } from './config.ts';
import { refreshAll } from './refresh.ts';
import { LAUNCH_AREAS, applySeed, refreshBeer } from './beer/refresh.ts';
import { rankItems } from './pricing/engine.ts';
import { mergeResults } from './normalize.ts';
import { repairPackWeight } from './sanitize.ts';
import './sources/register.ts';

import { mergeWeed, okAt, type WeedSnapshot } from './merge-weed.ts';
export type { WeedSnapshot };
export interface BeerSnapshot { venues: BeerVenue[]; prices: BeerPrice[]; happyHours: HappyHour[]; status: RefreshStatus; area: { lat: number; lng: number; miles: number }; areas?: { lat: number; lng: number; miles: number }[] }

const outDir = resolve(process.argv[2] ?? 'static-data');
const KEEP_PER_STORE_CATEGORY = 60;

async function fetchSnap(dir: string | undefined): Promise<{ w: WeedSnapshot | null; b: BeerSnapshot | null }> {
  if (!dir) return { w: null, b: null };
  const get = <T>(f: string) => fetch(`${dir.replace(/\/+$/, '')}/${f}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<T> : null)).catch(() => null);
  // One weed file per city (weed.json = San Diego, weed-nyc.json = New York): read them all as one snapshot.
  const [b, ...ws] = await Promise.all([get<BeerSnapshot>('beer.json'), ...Object.values(WEED_FILES).map((f) => get<WeedSnapshot>(f!))]);
  const got = ws.filter((x): x is WeedSnapshot => !!x);
  const w = got.length ? {
    stores: got.flatMap((x) => x.stores), products: got.flatMap((x) => x.products), deals: got.flatMap((x) => x.deals),
    status: { running: false, lastRefreshAt: got.map((x) => x.status.lastRefreshAt ?? '').sort().pop(), sources: got.flatMap((x) => x.status.sources) },
  } : null;
  return { w, b };
}

/**
 * Start from the best data we already have, so a source that fails today keeps its last good data:
 *  - PREV_URL: the live website's current data
 *  - PC_DATA_URL: data pushed by the PC to the `data` branch (the PC can reach sources GitHub can't, e.g. Dutchie)
 */
async function loadPrevious() {
  const prev = await fetchSnap(process.env.PREV_URL && `${process.env.PREV_URL.replace(/\/+$/, '')}/data`);
  const pc = await fetchSnap(process.env.PC_DATA_URL);
  const w = mergeWeed([prev.w, pc.w].filter((x): x is WeedSnapshot => !!x));
  if (w) { repo.replaceCatalog(w.stores, w.products, w.deals); repo.setRefreshStatus(w.status); console.log(`[export] starting weed data: ${w.products.length} products (${w.status.sources.map((s) => s.source).join(', ')})`); }
  for (const b of [prev.b, pc.b].filter((x): x is BeerSnapshot => !!x).sort((a, b) => okAt(a.status, 'bar-websites') - okAt(b.status, 'bar-websites'))) {
    beerRepo.upsertVenues(b.venues);
    if (b.prices.length || b.happyHours.length) beerRepo.replaceWebsiteFor(b.venues.map((v) => v.id), b.prices.filter((p) => p.source === 'website'), b.happyHours);
    if (b.venues.length) beerRepo.setStatus(b.status);
    console.log(`[export] starting beer data: ${b.venues.length} places`);
  }
}

/** Keep the cheapest products per store and category, ranked as someone in that city sees them. */
function trimProducts(stores: Store[], products: Product[], deals: Deal[], region: RegionId): Product[] {
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const keep = new Set<string>();
  const c = REGIONS[region].center;
  const viewer = region === 'us' ? DEFAULT_PROFILE : { ...DEFAULT_PROFILE, lat: c.lat, lng: c.lng, radiusMiles: c.miles };
  for (const mode of ['pickup', 'delivery'] as const) {
    const ranked = rankItems(products, storeMap, deals, new Map(), viewer, { mode });
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
// Hand-checked deals (beer-seed.json) always go in, even when nothing is refreshed: the previous snapshot only
// carries over website-found prices, so without this a code-only deploy dropped them.
applySeed();
const weedBefore = repo.refreshStatus(), beerBefore = beerRepo.status();
console.log('[export] sources:', Object.entries(config.sources).filter(([, on]) => on).map(([k]) => k).join(', '));
// SKIP_REFRESH=1: just export what's in the database (for testing).
const only = ({ sandiego: 'us', newyork: 'nyc', athens: 'europe' } as const)[process.env.REFRESH ?? ''];
if (process.env.SKIP_REFRESH) {
  // just merge
} else if (only) {
  console.log(`[export] ${process.env.REFRESH} only`);
  // Weed (San Diego / New York) and beer for that city run side by side; one failing doesn't stop the other.
  await Promise.all([
    only === 'europe' ? null : refreshAll({ region: only }).catch((e) => console.error('[export] weed', e)),
    refreshBeer({ region: only, forceOsm: true }).catch((e) => console.error('[export] beer', e)),
  ]);
} else {
  await Promise.all([
    refreshAll().catch((e) => console.error('[export] weed', e)),
    refreshBeer({ forceOsm: true }).catch((e) => console.error('[export] beer', e)),
  ]);
}
const weedRun = repo.refreshStatus();

// A source that failed today is still shown with its last good data: report that, not the failure.
const keepGood = (now: RefreshStatus, before: RefreshStatus): RefreshStatus => ({
  ...now,
  sources: now.sources.map((x) => (x.ok ? x : before.sources.find((b) => b.source === x.source && (b.region ?? 'us') === (x.region ?? 'us') && b.ok) ?? x)),
});
const weedStatus = keepGood(weedRun, weedBefore);
beerRepo.setStatus(keepGood(beerRepo.status(), beerBefore));

// One weed file per city, each trimmed as someone in that city sees it.
const allStores = repo.stores(), allProducts = repo.products(), allDeals = repo.deals();
const weedFiles = Object.entries(WEED_FILES).map(([region, file]) => {
  const ids = new Set(allStores.filter((s) => regionAt(s).id === region).map((s) => s.id));
  const stores = allStores.filter((s) => ids.has(s.id)), deals = allDeals.filter((d) => ids.has(d.storeId));
  const products = trimProducts(stores, allProducts.filter((p) => ids.has(p.storeId)), deals, region as RegionId);
  const used = new Set(products.map((p) => p.storeId));
  const snap: WeedSnapshot = {
    stores: stores.filter((s) => used.has(s.id)), products, deals: deals.filter((d) => used.has(d.storeId)),
    status: { ...weedStatus, sources: weedStatus.sources.filter((s) => (s.region ?? 'us') === region) },
  };
  return { file: file!, snap };
});
const home = DEFAULT_PROFILE;
const beer: BeerSnapshot = {
  venues: beerRepo.venues(),
  prices: beerRepo.prices().filter((p) => p.source !== 'user'),
  happyHours: beerRepo.happyHours(),
  status: beerRepo.status(),
  area: { lat: home.lat, lng: home.lng, miles: 25 },
  // Every area whose places are in this file (home + launch cities like Athens).
  areas: [{ lat: home.lat, lng: home.lng, miles: 25 }, ...LAUNCH_AREAS.map(({ lat, lng, miles }) => ({ lat, lng, miles }))],
};

mkdirSync(outDir, { recursive: true });
for (const { file, snap } of weedFiles) writeFileSync(resolve(outDir, file), JSON.stringify(snap));
writeFileSync(resolve(outDir, 'beer.json'), JSON.stringify(beer));
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify({ builtAt: new Date().toISOString(), weed: weedStatus, beer: beer.status }));
console.log(`[export] wrote ${outDir}: ${weedFiles.map(({ file, snap }) => `${file} ${snap.stores.length} stores / ${snap.products.length} products`).join(', ')}, ${beer.venues.length} beer places, ${beer.prices.length} beer prices`);
process.exit(0);
