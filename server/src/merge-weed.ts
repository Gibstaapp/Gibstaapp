import { regionAt, type Deal, type Product, type RefreshStatus, type Store } from '@gib/shared';
import { mergeResults } from './normalize.ts';
import { repairPackWeight } from './sanitize.ts';

export interface WeedSnapshot { stores: Store[]; products: Product[]; deals: Deal[]; status: RefreshStatus }

export const okAt = (st: RefreshStatus | undefined, source: string, region: string = 'us') => {
  const s = st?.sources.find((x) => x.source === source && (x.region ?? 'us') === region && x.ok && (x.products > 0 || x.stores > 0));
  return s ? new Date(s.finishedAt).getTime() : -1;
};

/** Per source and per city (San Diego / New York), keep whichever snapshot got it most recently. */
export function mergeWeed(snaps: WeedSnapshot[]): WeedSnapshot | null {
  if (!snaps.length) return null;
  const regionOfStore = (s: Store) => regionAt(s).id;
  const keys = new Set<string>();
  for (const sn of snaps) {
    for (const x of sn.status.sources) keys.add(`${x.source}|${x.region ?? 'us'}`);
    const storeRegion = new Map(sn.stores.map((s) => [s.id, regionOfStore(s)]));
    for (const p of sn.products) keys.add(`${p.source}|${storeRegion.get(p.storeId) ?? 'us'}`);
  }
  const products: Product[] = [], deals: Deal[] = [], statuses: RefreshStatus['sources'] = [];
  const storeById = new Map<string, Store>();
  for (const key of keys) {
    const [src, region] = key.split('|');
    const best = [...snaps].sort((a, b) => okAt(b.status, src, region) - okAt(a.status, src, region))[0];
    const here = new Set(best.stores.filter((s) => regionOfStore(s) === region).map((s) => s.id));
    products.push(...best.products.filter((p) => p.source === src && here.has(p.storeId)));
    deals.push(...best.deals.filter((d) => d.source === src && here.has(d.storeId)));
    // A store can come from several snapshots (merged across sources): keep hours from whichever one has them.
    for (const s of best.stores) if (here.has(s.id) && s.sources.some((x) => x.source === src)) storeById.set(s.id, { ...s, hours: s.hours ?? storeById.get(s.id)?.hours });
    const st = best.status.sources.find((x) => x.source === src && (x.region ?? 'us') === region);
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

