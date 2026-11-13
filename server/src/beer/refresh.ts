import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BeerPrice, BeerVenue, SourceStatus } from '@gib/shared';
import { beerRepo, repo, type BeerArea } from '../db.ts';
import { haversineMiles } from '../pricing/engine.ts';
import { fetchOsmVenues } from './osm.ts';
import { crawlVenueSites } from './websites.ts';

/**
 * Beer data is location-based: wherever someone opens the beer tab, we load the places around
 * them from OpenStreetMap (once, then refresh weekly) and read those places' websites for
 * happy hours and prices. Only sources that are online and reasonably reliable; nothing is guessed.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = resolve(here, '../../beer-seed.json');
const OSM_MAX_AGE_MS = 6 * 86400_000;      // places don't change often; Overpass is slow
const AREA_KEEP_MS = 30 * 86400_000;       // stop refreshing areas nobody has looked at in a month
const HOME_MILES = 25;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const at = () => new Date().toISOString();
const log = (src: string) => (m: string) => console.log(`[beer:${src}] ${m}`);

/** beer-seed.json: hand-entered places + prices (deals we've confirmed in person). */
export function loadSeed(venues: BeerVenue[]): { venues: BeerVenue[]; prices: BeerPrice[] } {
  if (!existsSync(SEED_FILE)) return { venues: [], prices: [] };
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as { venues?: any[]; prices?: any[] };
  const newVenues: BeerVenue[] = (seed.venues ?? []).filter((v) => !v.example).map((v) => ({
    id: v.id ?? `seed:${norm(v.name)}`, name: v.name, kind: v.kind ?? 'bar', lat: v.lat, lng: v.lng,
    address: v.address, website: v.website, openingHours: v.openingHours, source: 'seed' as const,
  }));
  const all = [...venues, ...newVenues];
  const prices: BeerPrice[] = [];
  for (const [i, p] of (seed.prices ?? []).entries()) {
    if (p.example) continue;
    let venue = p.venueId ? all.find((v) => v.id === p.venueId) : undefined;
    if (!venue && p.name) {
      const cands = all.filter((v) => norm(v.name) === norm(p.name));
      venue = p.near ? cands.sort((a, b) => haversineMiles(a.lat, a.lng, p.near[0], p.near[1]) - haversineMiles(b.lat, b.lng, p.near[0], p.near[1]))[0] : cands[0];
    }
    if (!venue) { console.warn(`[beer seed] no place matches "${p.name ?? p.venueId}"`); continue; }
    prices.push({
      id: `seed:${i}:${venue.id}`, venueId: venue.id, item: p.item, price: p.price, size: p.size, kind: p.kind ?? 'regular',
      days: p.days, start: p.start, end: p.end,
      source: p.source === 'team' ? 'team' : 'seed', snippet: p.note, reportedAt: p.date ?? at(),
    });
  }
  return { venues: newVenues, prices };
}

function applySeed() {
  const seed = loadSeed(beerRepo.venues());
  beerRepo.upsertVenues(seed.venues);
  beerRepo.replaceFromSource(['seed', 'team'], seed.prices, []);
}

const inArea = (a: BeerArea, v: { lat: number; lng: number }) => haversineMiles(a.lat, a.lng, v.lat, v.lng) <= a.miles;

// ---------- on-demand: load a new area when someone opens the app somewhere new ----------
const inflight = new Map<string, Promise<void>>();

/** Make sure places around (lat, lng) are loaded. Resolves when places are in (websites keep loading in the background). */
export function ensureArea(lat: number, lng: number, wantMiles: number): Promise<void> {
  const areas = beerRepo.areas();
  const need = Math.min(wantMiles, 15);
  const covering = areas.find((a) => haversineMiles(a.lat, a.lng, lat, lng) + need <= a.miles);
  if (covering) {
    if (Date.now() - new Date(covering.usedAt).getTime() > 3600_000) {
      covering.usedAt = at();
      beerRepo.setAreas(areas);
    }
    return Promise.resolve();
  }
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const existing = [...inflight.entries()].find(([k]) => k === key)?.[1];
  if (existing) return existing;
  const miles = Math.min(25, Math.max(10, wantMiles + 3));
  const p = (async () => {
    const venues = await fetchOsmVenues({ lat, lng, miles }, log('osm'));
    beerRepo.upsertVenues(venues);
    const area: BeerArea = { lat, lng, miles, fetchedAt: at(), usedAt: at() };
    beerRepo.setAreas([...beerRepo.areas(), area]);
    applySeed();
    // Websites take a few minutes; don't make the person wait for them.
    crawlArea(area).catch((e) => console.error('[beer:web]', e));
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function crawlArea(area: BeerArea) {
  const venues = beerRepo.venues().filter((v) => inArea(area, v));
  const r = await crawlVenueSites(venues, log('web'));
  beerRepo.replaceWebsiteFor(venues.filter((v) => v.website).map((v) => v.id), r.prices, r.happyHours);
  const areas = beerRepo.areas();
  const me = areas.find((a) => a.lat === area.lat && a.lng === area.lng);
  if (me) { me.crawledAt = at(); beerRepo.setAreas(areas); }
  return r;
}

// ---------- scheduled / refresh button: re-check every area in use ----------
let running: Promise<SourceStatus[]> | null = null;
export const isBeerRefreshing = () => running !== null || inflight.size > 0;

export function refreshBeer(opts: { forceOsm?: boolean } = {}): Promise<SourceStatus[]> {
  if (running) return running;
  running = (async () => {
    const prev = beerRepo.status();
    beerRepo.setStatus({ ...prev, running: true });
    const statuses: SourceStatus[] = [];

    // Home area always; drop areas nobody has used in a month.
    const home = repo.profile();
    let areas = beerRepo.areas().filter((a) => Date.now() - new Date(a.usedAt).getTime() < AREA_KEEP_MS);
    if (!areas.some((a) => haversineMiles(a.lat, a.lng, home.lat, home.lng) < 3 && a.miles >= HOME_MILES - 1)) {
      areas.unshift({ lat: home.lat, lng: home.lng, miles: HOME_MILES, fetchedAt: new Date(0).toISOString(), usedAt: at() });
    }

    // 1. Places (OpenStreetMap), weekly per area.
    let osmFail: string | undefined;
    for (const a of areas) {
      if (!opts.forceOsm && Date.now() - new Date(a.fetchedAt).getTime() < OSM_MAX_AGE_MS) continue;
      try {
        beerRepo.upsertVenues(await fetchOsmVenues(a, log('osm')));
        a.fetchedAt = at();
      } catch (e) { osmFail = (e as Error).message; }
    }
    beerRepo.setAreas(areas);
    const venues = beerRepo.venues();
    const inUse = venues.filter((v) => areas.some((a) => inArea(a, v)));
    statuses.push({ source: 'osm', ok: !osmFail, stores: inUse.length, products: 0, error: osmFail, finishedAt: at() });

    // 2. Hand-entered places/prices.
    applySeed();

    // 3. Bar & brewery websites (happy hours, menu prices) for every area in use.
    try {
      const r = await crawlVenueSites(inUse, log('web'));
      beerRepo.replaceWebsiteFor(inUse.filter((v) => v.website).map((v) => v.id), r.prices, r.happyHours);
      areas = beerRepo.areas();
      for (const a of areas) a.crawledAt = at();
      beerRepo.setAreas(areas);
      statuses.push({ source: 'bar-websites', ok: true, stores: r.sitesWithInfo, products: r.prices.length + r.happyHours.length, finishedAt: at() });
    } catch (e) {
      statuses.push({ source: 'bar-websites', ok: false, stores: 0, products: 0, error: (e as Error).message, finishedAt: at() });
    }

    beerRepo.setStatus({ running: false, lastRefreshAt: at(), sources: statuses });
    return statuses;
  })().finally(() => { running = null; });
  return running;
}
