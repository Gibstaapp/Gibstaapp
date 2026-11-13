/**
 * Build the data files for the always-on website (GitHub Pages).
 *
 *   GIB_DB=/tmp/snap.db PREV_URL=https://<github-owner>.github.io/Gibstaapp npx tsx src/export-static.ts ../web/dist/data
 *
 * REFRESH=athens: only the Athens beer refresh (euros); weed and San Diego beer keep the data they have.
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
import type { BeerPrice, BeerVenue, Deal, HappyHour, Product, RefreshStatus, Store } from '@gib/shared';
import { beerRepo, repo, DEFAULT_PROFILE } from './db.ts';
import { config } from './config.ts';
import { refreshAll } from './refresh.ts';
import { LAUNCH_AREAS, applySeed, refreshBeer } from './beer/refresh.ts';
import { rankItems } from './pricing/engine.ts';
import { mergeResults } from './normalize.ts';
import { repairPackWeight } from './sanitize.ts';
import './sources/register.ts';

export interface WeedSnapshot { stores: Store[]; products: Product[]; deals: Deal[]; status: RefreshStatus }
export interface BeerSnapshot { venues: BeerVenue[]; prices: BeerPrice[]; happyHours: HappyHour[]; status: RefreshStatus; area: { lat: number; lng: number; miles: number }; areas?: { lat: number; lng: number; miles: number }[] }

const outDir = resolve(process.argv[2] ?? 'static-data');
const KEEP_PER_STORE_CATEGORY = 60;

async function fetchSnap(dir: string | undefined): Promise<{ w: WeedSnapshot | null; b: BeerSnapshot | null }> {
  if (!dir) return { w: null, b: null };
  const get = <T>(f: string) => fetch(`${dir.replace(/\/+$/, '')}/${f}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<T> : null)).catch(() => null);
  const [w, b] = await Promise.all([get<WeedSnapshot>('weed.json'), get<BeerSnapshot>('beer.json')]);
  return { w, b };
}

const okAt = (st: RefreshStatus | undefined, source: string) => {
  const s = st?.sources.find((x) => x.source === source && x.ok && (x.products > 0 || x.stores > 0));
  return s ? new Date(s.finishedAt).getTime() : -1;
};

/** Per source, keep whichever snapshot got it most recently. */
export function mergeWeed(snaps: WeedSnapshot[]): WeedSnapshot | null {
  if (!snaps.length) return null;
  const sources = new Set(snaps.flatMap((s) => [...s.status.sources.map((x) => x.source), ...s.products.map((p) => p.source)]));
  const products: Product[] = [], deals: Deal[] = [], statuses: RefreshStatus['sources'] = [];
  const storeById = new Map<string, Store>();
  for (const src of sources) {
    const best = [...snaps].sort((a, b) => okAt(b.status, src) - okAt(a.status, src))[0];
    products.push(...best.products.filter((p) => p.source === src));
    deals.push(...best.deals.filter((d) => d.source === src));
    // A store can come from several snapshots (merged across sources): keep hours from whichever one has them.
    for (const s of best.stores) if (s.sources.some((x) => x.source === src)) storeById.set(s.id, { ...s, hours: s.hours ?? storeById.get(s.id)?.hours });
    const st = best.status.sources.find((x) => x.source === src);
    if (st) statuses.push(st);
  }
  // The same shop can arrive under two ids (e.g. "dutchie:…" from the PC and "weedmaps:…" from GitHub): fold them together.
  const merged = mergeResults([{ stores: [...storeById.values()], products: products.map(repairPackWeight), deals }]);
  const used = new Set(merged.products.map((p) => p.storeId));
  return {
    stores: merged.stores.filter((s) => used.has(s.id)), products: merged.products, deals: merged.deals,
    status: { running: false, lastRefreshAt: snaps.map((s) => s.status.lastRefreshAt ?? '').sort().pop(), sources: statuses },
  };
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
// Hand-checked deals (beer-seed.json) always go in, even when nothing is refreshed: the previous snapshot only
// carries over website-found prices, so without this a code-only deploy dropped them.
applySeed();
const weedBefore = repo.refreshStatus(), beerBefore = beerRepo.status();
console.log('[export] sources:', Object.entries(config.sources).filter(([, on]) => on).map(([k]) => k).join(', '));
// SKIP_REFRESH=1: just export what's in the database (for testing).
const athensOnly = process.env.REFRESH === 'athens';
const [weedRun] = process.env.SKIP_REFRESH || athensOnly ? [repo.refreshStatus()] : await Promise.all([
  refreshAll(),
  // San Diego ($) and Athens (€) are separate refreshes; one failing doesn't stop the other.
  refreshBeer({ forceOsm: true }).catch((e) => console.error('[export] beer', e)),
]);
if (athensOnly && !process.env.SKIP_REFRESH) {
  console.log('[export] Athens-only beer refresh');
  await refreshBeer({ region: 'europe', forceOsm: true }).catch((e) => console.error('[export] athens', e));
}

// A source that failed today is still shown with its last good data: report that, not the failure.
const keepGood = (now: RefreshStatus, before: RefreshStatus): RefreshStatus => ({
  ...now,
  sources: now.sources.map((x) => (x.ok ? x : before.sources.find((b) => b.source === x.source && b.ok) ?? x)),
});
const weedStatus = keepGood(weedRun, weedBefore);
beerRepo.setStatus(keepGood(beerRepo.status(), beerBefore));

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
  // Every area whose places are in this file (home + launch cities like Athens).
  areas: [{ lat: home.lat, lng: home.lng, miles: 25 }, ...LAUNCH_AREAS.map(({ lat, lng, miles }) => ({ lat, lng, miles }))],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'weed.json'), JSON.stringify(weed));
writeFileSync(resolve(outDir, 'beer.json'), JSON.stringify(beer));
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify({ builtAt: new Date().toISOString(), weed: weedStatus, beer: beer.status }));
console.log(`[export] wrote ${outDir}: ${weed.stores.length} stores, ${weed.products.length} products, ${beer.venues.length} beer places, ${beer.prices.length} beer prices`);
process.exit(0);
