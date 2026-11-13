import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BeerPrice, BeerVenue, HappyHour, RefreshStatus, SourceStatus } from '@gib/shared';
import { beerRepo, repo, DEFAULT_PROFILE, type BeerArea } from '../db.ts';
import { BEER_STATUS_SOURCES, REGIONS, regionAt, type RegionId } from '@gib/shared';
import { haversineMiles } from '../pricing/engine.ts';
import { fetchOsmVenues } from './osm.ts';
import { crawlVenueSites } from './websites.ts';
import { inGreece } from '../hours.ts';

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
/** Cities we launched in, refreshed every day next to home (so they load instantly on the website). */
export const LAUNCH_AREAS = [
  { name: 'Athens', lat: 37.9838, lng: 23.7275, miles: 25 },
  { name: 'New York', lat: REGIONS.nyc.center.lat, lng: REGIONS.nyc.center.lng, miles: REGIONS.nyc.center.miles },
];

// Letters in any alphabet, so Greek names match too.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
const at = () => new Date().toISOString();
const log = (src: string) => (m: string) => console.log(`[beer:${src}] ${m}`);

/** beer-seed.json: hand-entered places, prices and happy hours (confirmed in person, or from the bar's own menu). */
export function loadSeed(venues: BeerVenue[], file = SEED_FILE): { venues: BeerVenue[]; prices: BeerPrice[]; happyHours: HappyHour[] } {
  if (!existsSync(file)) return { venues: [], prices: [], happyHours: [] };
  const seed = JSON.parse(readFileSync(file, 'utf8')) as { venues?: any[]; prices?: any[]; happyHours?: any[] };
  const newVenues: BeerVenue[] = (seed.venues ?? []).filter((v) => !v.example).map((v) => ({
    id: v.id ?? `seed:${norm(v.name)}`, name: v.name, kind: v.kind ?? 'bar', lat: v.lat, lng: v.lng,
    address: v.address, website: v.website, openingHours: v.openingHours, source: 'seed' as const,
  }));
  const all = [...venues, ...newVenues];
  const find = (p: any): BeerVenue | undefined => {
    let venue = p.venueId ? all.find((v) => v.id === p.venueId) : undefined;
    if (!venue && p.name) {
      // Same name, and within 1 mile of 'near' when given (so a namesake across town never matches).
      const cands = all.filter((v) => norm(v.name) === norm(p.name) && (!p.near || haversineMiles(v.lat, v.lng, p.near[0], p.near[1]) < 1));
      venue = p.near ? cands.sort((a, b) => haversineMiles(a.lat, a.lng, p.near[0], p.near[1]) - haversineMiles(b.lat, b.lng, p.near[0], p.near[1]))[0] : cands[0];
    }
    if (!venue) console.warn(`[beer seed] no place matches "${p.name ?? p.venueId}"`);
    return venue;
  };
  const prices: BeerPrice[] = [];
  for (const [i, p] of (seed.prices ?? []).entries()) {
    if (p.example) continue;
    const venue = find(p);
    if (!venue) continue;
    prices.push({
      id: `seed:${i}:${venue.id}`, venueId: venue.id, item: p.item, price: p.price, size: p.size, kind: p.kind ?? 'regular',
      ...(p.currency === 'EUR' ? { currency: 'EUR' as const } : {}),
      ...(typeof p.menuDate === 'string' ? { menuDate: p.menuDate } : {}),
      days: p.days, start: p.start, end: p.end,
      source: p.source === 'team' ? 'team' : 'seed', snippet: p.note, sourceUrl: p.url,
      // A bare date ("2026-11-13") means that day anywhere: noon UTC, so no time zone shows it as the day before.
      reportedAt: typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? `${p.date}T12:00:00.000Z` : p.date ?? at(),
    });
  }
  const happyHours: HappyHour[] = [];
  for (const h of seed.happyHours ?? []) {
    if (h.example) continue;
    const venue = find(h);
    if (!venue || !h.start || !h.end) continue;
    happyHours.push({ venueId: venue.id, days: h.days ?? [], start: h.start, end: h.end, text: h.note ?? '', source: 'seed', sourceUrl: h.url });
  }
  return { venues: newVenues, prices, happyHours };
}

export function applySeed() {
  const seed = loadSeed(beerRepo.venues());
  beerRepo.upsertVenues(seed.venues);
  beerRepo.replaceFromSource(['seed', 'team'], seed.prices, seed.happyHours);
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

// ---------- two separate daily refreshes: San Diego ($) and Athens (€) ----------
// Each has its own places, website reading, status lines and schedule (7 AM local time), and a problem in one
// never touches the other. refreshBeer() with no region runs both, one after the other (the refresh button).

export type BeerRegionId = RegionId;
/** Status lines each refresh owns (shown in the app's refresh details). */
export const BEER_SOURCES = BEER_STATUS_SOURCES as Record<RegionId, SourceStatus['source'][]>;
export const BEER_REFRESH_TIME_ZONE = Object.fromEntries(Object.values(REGIONS).map((r) => [r.id, r.timeZone])) as Record<RegionId, string>;

const running = new Map<RegionId, Promise<SourceStatus[]>>();
export const isBeerRefreshing = () => running.size > 0 || inflight.size > 0;

export async function refreshBeer(opts: { forceOsm?: boolean; region?: RegionId } = {}): Promise<SourceStatus[]> {
  if (opts.region) return refreshBeerRegion(opts.region, !!opts.forceOsm);
  const all: SourceStatus[] = [];
  for (const r of ['us', 'nyc', 'europe'] as const) {
    all.push(...await refreshBeerRegion(r, !!opts.forceOsm).catch((e) => { console.error(`[beer ${r}]`, e); return [] as SourceStatus[]; }));
  }
  return all;
}

/** This refresh's status lines replace only its own; the other city's stay exactly as they were. */
export function mergeBeerStatus(prev: RefreshStatus, region: RegionId, mine: SourceStatus[] | null, isRunning: boolean): RefreshStatus {
  const others = (prev.sources ?? []).filter((s) => !BEER_SOURCES[region].includes(s.source));
  const sources = mine ? [...others, ...mine] : prev.sources ?? [];
  return { ...prev, running: isRunning, sources, lastRefreshAt: sources.map((s) => s.finishedAt).sort().pop() ?? prev.lastRefreshAt };
}
const saveStatus = (region: RegionId, mine: SourceStatus[] | null) => beerRepo.setStatus(mergeBeerStatus(beerRepo.status(), region, mine, running.size > 0));

function refreshBeerRegion(region: RegionId, forceOsm: boolean): Promise<SourceStatus[]> {
  const already = running.get(region);
  if (already) return already;
  const job = (async () => {
    saveStatus(region, null);
    const [placesSrc, sitesSrc] = BEER_SOURCES[region];
    const tag = region === 'europe' ? 'athens' : region === 'nyc' ? 'nyc' : 'osm';
    const statuses: SourceStatus[] = [];
    const mine = (a: { lat: number; lng: number }) => regionAt(a).id === region;

    // This region's areas (drop ones nobody has used in a month); always its home / launch city.
    const all = beerRepo.areas().filter((a) => Date.now() - new Date(a.usedAt).getTime() < AREA_KEEP_MS);
    const areas = all.filter(mine);
    const keep = (c: { lat: number; lng: number; miles: number }) => {
      const have = areas.find((a) => haversineMiles(a.lat, a.lng, c.lat, c.lng) < 3 && a.miles >= c.miles - 1);
      if (have) have.usedAt = at();
      else areas.unshift({ lat: c.lat, lng: c.lng, miles: c.miles, fetchedAt: new Date(0).toISOString(), usedAt: at() });
    };
    if (region === 'us') {
      const p = repo.profile();
      keep(mine(p) ? { lat: p.lat, lng: p.lng, miles: HOME_MILES } : { lat: DEFAULT_PROFILE.lat, lng: DEFAULT_PROFILE.lng, miles: HOME_MILES });
    } else {
      for (const c of LAUNCH_AREAS) if (mine(c)) keep(c);
    }

    // 1. Places (OpenStreetMap), weekly per area.
    let osmFail: string | undefined;
    for (const a of areas) {
      if (!forceOsm && Date.now() - new Date(a.fetchedAt).getTime() < OSM_MAX_AGE_MS) continue;
      try {
        beerRepo.upsertVenues(await fetchOsmVenues(a, log(tag)));
        a.fetchedAt = at();
      } catch (e) { osmFail = (e as Error).message; }
    }
    beerRepo.setAreas([...beerRepo.areas().filter((a) => !mine(a)), ...areas]);
    const inUse = beerRepo.venues().filter((v) => mine(v) && areas.some((a) => inArea(a, v)));
    statuses.push({ source: placesSrc, ok: !osmFail, stores: inUse.length, products: 0, error: osmFail, finishedAt: at() });

    // 2. Hand-entered places/prices (both cities live in one file; applying it is cheap and idempotent).
    applySeed();

    // 3. The bars' own websites (and their PDF menus): dollars in San Diego and New York, euros in Athens.
    statuses.push(region === 'europe'
      ? await refreshAthensMenus(inUse)
      : await readSites(inUse, 'USD', sitesSrc, log(region === 'nyc' ? 'nyc-web' : 'web')));
    const done = beerRepo.areas();
    for (const a of done) if (mine(a)) a.crawledAt = at();
    beerRepo.setAreas(done);
    return statuses;
  })();
  running.set(region, job);
  return job.then((st) => { running.delete(region); saveStatus(region, st); return st; }, (e) => { running.delete(region); saveStatus(region, null); throw e; });
}

async function readSites(venues: BeerVenue[], currency: 'USD' | 'EUR', source: SourceStatus['source'], logFn: (m: string) => void): Promise<SourceStatus> {
  try {
    const r = await crawlVenueSites(venues, logFn, 8, currency);
    beerRepo.replaceWebsiteFor(r.readIds, r.prices, r.happyHours);
    return { source, ok: true, stores: r.sitesWithInfo, products: r.prices.length + r.happyHours.length, finishedAt: at() };
  } catch (e) {
    return { source, ok: false, stores: 0, products: 0, error: (e as Error).message, finishedAt: at() };
  }
}

/**
 * Athens: read the bars' own websites for euro prices and happy hours (the website step of the Athens refresh;
 * `npm run athens -w server` runs just this). A site that fails to load keeps its previous prices.
 */
export async function refreshAthensMenus(venues: BeerVenue[] = beerRepo.venues().filter((v) => inGreece(v))): Promise<SourceStatus> {
  return readSites(venues, 'EUR', 'athens-menus', log('athens'));
}
