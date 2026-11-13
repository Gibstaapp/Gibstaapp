import { REGIONS, regionAt, regionOf, type RefreshStatus, type SourceStatus, type Store } from '@gib/shared';
import { repo, DEFAULT_PROFILE } from './db.ts';
import { config } from './config.ts';
import { mergeResults } from './normalize.ts';
import type { SearchArea, SourceAdapter, SourceResult } from './sources/types.ts';
import { sampleAdapter } from './sources/sample.ts';
import { rankItems } from './pricing/engine.ts';
import { sanitize } from './sanitize.ts';

export const ADAPTERS: SourceAdapter[] = [sampleAdapter];

export function registerAdapter(a: SourceAdapter) {
  if (!ADAPTERS.some((x) => x.id === a.id)) ADAPTERS.push(a);
}

/** Cities with a weed side, each with its own daily refresh. 'us' = San Diego. */
export type WeedRegion = 'us' | 'nyc';
export const WEED_REGIONS: WeedRegion[] = ['us', 'nyc'];
const STATE: Record<WeedRegion, 'CA' | 'NY'> = { us: 'CA', nyc: 'NY' };
const DEFAULT_ZIP: Record<WeedRegion, string> = { us: DEFAULT_PROFILE.homeZip, nyc: '10003' };

/** Where a city's refresh looks. San Diego uses your saved home when it's in San Diego (as before). */
export function weedArea(region: WeedRegion): SearchArea {
  const p = repo.profile();
  if (region === 'us' && regionOf(p.homeZip).id === 'us') return { lat: p.lat, lng: p.lng, radiusMiles: p.radiusMiles, zip: p.homeZip, state: 'CA' };
  const c = REGIONS[region].center;
  return { lat: c.lat, lng: c.lng, radiusMiles: c.miles, zip: DEFAULT_ZIP[region], state: STATE[region] };
}

const inRegion = (region: WeedRegion) => (s: Pick<Store, 'lat' | 'lng'>) => regionAt(s).id === region;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** This city's status lines replace only its own; the other city's stay as they were. Old lines without a region are San Diego's. */
export function mergeWeedStatus(prev: RefreshStatus, region: WeedRegion, mine: SourceStatus[] | null, running: boolean): RefreshStatus {
  const others = (prev.sources ?? []).filter((s) => (s.region ?? 'us') !== region);
  const sources = mine ? [...others, ...mine] : prev.sources ?? [];
  return { ...prev, running, sources, lastRefreshAt: sources.map((s) => s.finishedAt).sort().pop() ?? prev.lastRefreshAt };
}

const running = new Map<WeedRegion, Promise<RefreshStatus>>();
export const isRefreshing = () => running.size > 0;

/**
 * Weed refresh. Each city (San Diego, New York) is its own refresh: it searches its own area, replaces only its own
 * stores, and a source that fails keeps that city's previous data. No region = San Diego then New York.
 */
export async function refreshAll(opts: { region?: WeedRegion } = {}): Promise<RefreshStatus> {
  if (opts.region) return refreshWeedRegion(opts.region);
  for (const r of WEED_REGIONS) await refreshWeedRegion(r).catch((e) => console.error(`[weed ${r}]`, e));
  return repo.refreshStatus();
}

function refreshWeedRegion(region: WeedRegion): Promise<RefreshStatus> {
  const already = running.get(region);
  if (already) return already;
  const job = (async () => {
    repo.setRefreshStatus(mergeWeedStatus(repo.refreshStatus(), region, null, true));
    const area = weedArea(region);
    const mine = inRegion(region);
    const enabled = ADAPTERS.filter((a) => a.enabled() && (!a.states || a.states.includes(area.state)));
    const tag = region === 'nyc' ? 'nyc ' : '';

    // Previous data, this city only, as a fallback for sources that fail today.
    const allStores = repo.stores(), allProducts = repo.products(), allDeals = repo.deals();
    const oldStores = allStores.filter(mine);
    const oldIds = new Set(oldStores.map((s) => s.id));

    const results: SourceResult[] = [];
    const statuses: SourceStatus[] = await Promise.all(enabled.map(async (a): Promise<SourceStatus> => {
      const log = (m: string) => console.log(`[${tag}${a.id}] ${m}`);
      try {
        const r = await withTimeout(a.fetchAll(area, log), config.sourceTimeoutMs, a.id);
        // Only stores that are really in this city (a source can return a few from far away).
        const keep = new Set(r.stores.filter(mine).map((s) => s.id));
        results.push({ stores: r.stores.filter((s) => keep.has(s.id)), products: r.products.filter((p) => keep.has(p.storeId)), deals: r.deals.filter((d) => keep.has(d.storeId)) });
        log(`ok: ${keep.size} stores, ${r.products.length} products, ${r.deals.length} deals`);
        return { source: a.id, region, ok: true, stores: keep.size, products: r.products.length, finishedAt: new Date().toISOString() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`FAILED: ${msg}`);
        results.push({
          stores: oldStores.filter((s) => s.sources.some((x) => x.source === a.id)),
          products: allProducts.filter((p) => p.source === a.id && oldIds.has(p.storeId)),
          deals: allDeals.filter((d) => d.source === a.id && oldIds.has(d.storeId)),
        });
        return { source: a.id, region, ok: false, stores: 0, products: 0, error: msg, finishedAt: new Date().toISOString() };
      }
    }));

    const merged0 = mergeResults(results);
    const merged = { ...merged0, ...sanitize(merged0.products, merged0.deals) };
    // Replace this city's catalog; the other city's stores, products and deals stay exactly as they were.
    const otherIds = new Set(allStores.filter((s) => !mine(s)).map((s) => s.id));
    repo.replaceCatalog(
      [...allStores.filter((s) => otherIds.has(s.id)), ...merged.stores],
      [...allProducts.filter((p) => otherIds.has(p.storeId)), ...merged.products],
      [...allDeals.filter((d) => otherIds.has(d.storeId)), ...merged.deals],
    );

    // Price history (pickup prices, as someone in this city sees them today).
    const viewer = { ...repo.profile(), lat: area.lat, lng: area.lng, radiusMiles: area.radiusMiles };
    const ranked = rankItems(merged.products, new Map(merged.stores.map((s) => [s.id, s])), merged.deals, new Map(), viewer, { mode: 'pickup' });
    repo.snapshot(ranked.map((r) => ({ productId: r.product.id, otd: r.otd, perUnit: r.perUnit })));
    return statuses;
  })();
  const done = job.then(
    (st) => { running.delete(region); const s = mergeWeedStatus(repo.refreshStatus(), region, st, running.size > 0); repo.setRefreshStatus(s); return s; },
    (e) => { running.delete(region); repo.setRefreshStatus(mergeWeedStatus(repo.refreshStatus(), region, null, running.size > 0)); throw e; },
  );
  running.set(region, done);
  return done;
}
