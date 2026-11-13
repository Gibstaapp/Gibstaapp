import type { RefreshStatus, SourceStatus } from '@gib/shared';
import { repo, DEFAULT_PROFILE } from './db.ts';
import { regionOf } from '@gib/shared';

const DEFAULT_PROFILE_AREA = { homeZip: DEFAULT_PROFILE.homeZip, lat: DEFAULT_PROFILE.lat, lng: DEFAULT_PROFILE.lng, radiusMiles: DEFAULT_PROFILE.radiusMiles };
import { config } from './config.ts';
import { mergeResults } from './normalize.ts';
import type { SourceAdapter, SourceResult } from './sources/types.ts';
import { sampleAdapter } from './sources/sample.ts';
import { rankItems } from './pricing/engine.ts';
import { sanitize } from './sanitize.ts';

export const ADAPTERS: SourceAdapter[] = [sampleAdapter];

export function registerAdapter(a: SourceAdapter) {
  if (!ADAPTERS.some((x) => x.id === a.id)) ADAPTERS.push(a);
}

let current: Promise<RefreshStatus> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/**
 * Run every enabled source in parallel. One source failing doesn't sink the refresh:
 * if a source fails we keep that source's data from the previous refresh.
 */
export function refreshAll(): Promise<RefreshStatus> {
  if (current) return current; // already running: share the result
  current = (async () => {
    const prev = repo.refreshStatus();
    repo.setRefreshStatus({ ...prev, running: true });
    // Weed menus are scraped around San Diego; if the saved home is somewhere weed isn't legal, scrape San Diego anyway.
    const saved = repo.profile();
    const profile = regionOf(saved.homeZip).weedLegal ? saved : { ...saved, ...DEFAULT_PROFILE_AREA };
    const area = { lat: profile.lat, lng: profile.lng, radiusMiles: profile.radiusMiles, zip: profile.homeZip };
    const enabled = ADAPTERS.filter((a) => a.enabled());

    // Previous data grouped by source, as a fallback for failed sources.
    const oldStores = repo.stores(), oldProducts = repo.products(), oldDeals = repo.deals();

    const results: SourceResult[] = [];
    const statuses: SourceStatus[] = await Promise.all(enabled.map(async (a): Promise<SourceStatus> => {
      const log = (m: string) => console.log(`[${a.id}] ${m}`);
      try {
        const r = await withTimeout(a.fetchAll(area, log), config.sourceTimeoutMs, a.id);
        results.push(r);
        log(`ok: ${r.stores.length} stores, ${r.products.length} products, ${r.deals.length} deals`);
        return { source: a.id, ok: true, stores: r.stores.length, products: r.products.length, finishedAt: new Date().toISOString() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`FAILED: ${msg}`);
        results.push({
          stores: oldStores.filter((s) => s.sources.some((x) => x.source === a.id)),
          products: oldProducts.filter((p) => p.source === a.id),
          deals: oldDeals.filter((d) => d.source === a.id),
        });
        return { source: a.id, ok: false, stores: 0, products: 0, error: msg, finishedAt: new Date().toISOString() };
      }
    }));

    const merged0 = mergeResults(results);
    const merged = { ...merged0, ...sanitize(merged0.products, merged0.deals) };
    repo.replaceCatalog(merged.stores, merged.products, merged.deals);

    // Price history (pickup prices, as the user sees them today).
    const ranked = rankItems(merged.products, new Map(merged.stores.map((s) => [s.id, s])), merged.deals, new Map(), profile, { mode: 'pickup' });
    repo.snapshot(ranked.map((r) => ({ productId: r.product.id, otd: r.otd, perUnit: r.perUnit })));

    const status: RefreshStatus = { running: false, lastRefreshAt: new Date().toISOString(), sources: statuses };
    repo.setRefreshStatus(status);
    return status;
  })().finally(() => { current = null; });
  return current;
}

export const isRefreshing = () => current !== null;
