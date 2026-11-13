/**
 * "Static" mode for the always-on website (GitHub Pages): no server.
 * A GitHub Action builds data/weed.json + data/beer.json every morning; this file
 * does everything the server API would, right in the browser:
 *  - weed pricing (deals, taxes, veteran/student, "I've been here") per person,
 *  - beer places for wherever you are (straight from OpenStreetMap),
 *  - settings, visited stores and price reports saved on this phone.
 */
import type { BeerPrice, BeerQuery, BeerReport, BeerVenue, Category, HappyHour, Mode, PricedItem, RankedVenue, RefreshStatus, Store, StoreOverride, UserProfile } from '@gib/shared';
import { rankItems, effectiveStore, haversineMiles } from '../../server/src/pricing/engine.ts';
import { rankVenues } from '../../server/src/beer/rank.ts';
import { fetchOsmVenues } from '../../server/src/beer/osm.ts';
import { AREAS, WEED_FILES, regionOf } from '@gib/shared';

interface WeedSnapshot { stores: Store[]; products: import('@gib/shared').Product[]; deals: import('@gib/shared').Deal[]; status: RefreshStatus }
interface BeerSnapshot { venues: BeerVenue[]; prices: BeerPrice[]; happyHours: HappyHour[]; status: RefreshStatus; area: { lat: number; lng: number; miles: number }; areas?: { lat: number; lng: number; miles: number }[] }

const BASE = import.meta.env.BASE_URL; // "/Gibstaapp/"
const DEFAULT_PROFILE: UserProfile = {
  homeZip: '92122', lat: 32.8566, lng: -117.2091, radiusMiles: 30,
  veteran: false, senior: false, student: false, visitedStoreIds: [], onboarded: false, notifyHour: 7,
};

const load = <T>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const save = (key: string, v: unknown) => localStorage.setItem(key, JSON.stringify(v));

const weedP = new Map<string, Promise<WeedSnapshot>>();
let beerP: Promise<BeerSnapshot> | null = null;
const getJson = async <T>(name: string): Promise<T> => {
  const r = await fetch(`${BASE}data/${name}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Couldn't load today's data (${r.status}). Try again in a minute.`);
  return r.json() as Promise<T>;
};
/** Weed data for your city only (weed.json = San Diego, weed-nyc.json = New York). */
const weed = () => {
  const file = WEED_FILES[regionOf(profile().homeZip).id] ?? 'weed.json';
  if (!weedP.has(file)) weedP.set(file, getJson<WeedSnapshot>(file).catch((e) => { weedP.delete(file); throw e; }));
  return weedP.get(file)!;
};
const beer = () => (beerP ??= getJson<BeerSnapshot>('beer.json').catch((e) => { beerP = null; throw e; }));

// ---------- profile (all on this phone) ----------
function profile(): UserProfile {
  const p = { ...DEFAULT_PROFILE, ...load<Partial<UserProfile>>('gib.personal', {}) };
  const z = AREAS[p.homeZip];
  if (z) { p.lat = z.lat; p.lng = z.lng; }
  return p;
}
const overrides = () => new Map(load<StoreOverride[]>('gib.overrides', []).map((o) => [o.storeId, o]));

// ---------- beer areas loaded in the browser ----------
interface Area { lat: number; lng: number; miles: number; venues: BeerVenue[] }
const areas: Area[] = [];
const inflight = new Map<string, Promise<void>>();
async function ensureArea(snap: BeerSnapshot, lat: number, lng: number, wantMiles: number): Promise<string | null> {
  const need = Math.min(wantMiles, 15);
  const covers = (a: { lat: number; lng: number; miles: number }) => haversineMiles(a.lat, a.lng, lat, lng) + need <= a.miles;
  if ((snap.venues.length > 0 && [snap.area, ...(snap.areas ?? [])].some(covers)) || areas.some(covers)) return null; // empty daily file = load places in the browser
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (!inflight.has(key)) {
    const miles = Math.min(25, Math.max(10, wantMiles + 3));
    inflight.set(key, fetchOsmVenues({ lat, lng, miles }).then((venues) => { areas.push({ lat, lng, miles, venues }); }).finally(() => inflight.delete(key)));
  }
  try {
    await inflight.get(key);
    return 'New area: places come from OpenStreetMap. Happy hours/prices are only checked daily for San Diego, New York and Athens, so most places here show "No price yet".';
  } catch (e) {
    return `Couldn't load places here right now (${(e as Error).message}). Try again in a minute.`;
  }
}

const reports = () => load<BeerPrice[]>('gib.beerReports', []);

export const staticApi = {
  auth: async (_pass: string) => ({ ok: true }),
  items: async (p: { category?: Category; mode: Mode; maxMiles?: number; search?: string; openNow?: boolean }): Promise<PricedItem[]> => {
    const prof = profile();
    if (!regionOf(prof.homeZip).weedLegal) return []; // no legal shops to show there
    const s = await weed();
    return rankItems(s.products, new Map(s.stores.map((x) => [x.id, x])), s.deals, overrides(), prof,
      { category: p.category, mode: p.mode, maxMiles: p.maxMiles ?? prof.radiusMiles, search: p.search, openNow: p.openNow, limit: 200 }).slice(0, 200);
  },
  stores: async () => {
    const s = await weed();
    const ov = overrides();
    return s.stores.map((st) => ({ store: effectiveStore(st, ov.get(st.id)), detected: st, override: ov.get(st.id) ?? null }));
  },
  setOverride: async (storeId: string, o: Partial<StoreOverride>): Promise<StoreOverride> => {
    const all = overrides();
    const next: StoreOverride = { ...(all.get(storeId) ?? { storeId }), ...o, storeId };
    all.set(storeId, next);
    save('gib.overrides', [...all.values()]);
    return next;
  },
  profile: async () => profile(),
  saveProfile: async (p: Partial<UserProfile>): Promise<UserProfile> => {
    if (p.homeZip && !AREAS[p.homeZip]) throw new Error(`Unknown area code ${p.homeZip}. Pick one from the list.`);
    save('gib.personal', { ...profile(), ...p });
    return profile();
  },
  setVisited: async (storeId: string, visited: boolean): Promise<UserProfile> => {
    const cur = profile();
    const set = new Set(cur.visitedStoreIds);
    visited ? set.add(storeId) : set.delete(storeId);
    save('gib.personal', { ...cur, visitedStoreIds: [...set] });
    return profile();
  },
  publicUrl: async () => ({ url: location.origin + BASE }),
  zips: async () => AREAS,
  status: async (): Promise<RefreshStatus> => ({ ...(await weed()).status, running: false }),
  refresh: async (_region?: 'us' | 'nyc' | 'europe'): Promise<RefreshStatus> => {
    const st = (await weed()).status;
    return { ...st, running: false, throttled: true, nextAllowedAt: nextMorning() };
  },
  testNotify: async () => ({ sent: false, body: '', reason: 'notifications run on the PC version' }),

  beer: {
    venues: async (q: BeerQuery): Promise<{ venues: RankedVenue[]; loading: string | null }> => {
      const s = await beer();
      const lat = Number.isFinite(q.lat) ? q.lat : profile().lat, lng = Number.isFinite(q.lng) ? q.lng : profile().lng;
      const loading = await ensureArea(s, lat, lng, q.maxMiles ?? 10);
      const byId = new Map(s.venues.map((v) => [v.id, v]));
      for (const a of areas) for (const v of a.venues) if (!byId.has(v.id)) byId.set(v.id, v);
      const venues = rankVenues({ ...q, lat, lng, limit: Math.min(q.limit ?? 150, 400) }, [...byId.values()], [...s.prices, ...reports()], s.happyHours);
      return { venues, loading };
    },
    status: async () => {
      const s = await beer();
      return { ...s.status, running: false, venues: s.venues.length, areas: 1 + areas.length };
    },
    // The website refreshes on GitHub (each city every morning, or by hand from the Actions tab), not from the phone.
    refresh: async (_region?: 'us' | 'nyc' | 'europe'): Promise<RefreshStatus> => ({ ...(await beer()).status, running: false, throttled: true, nextAllowedAt: nextMorning() }),
    /** No server here: reports are kept on this phone. */
    report: async (r: BeerReport): Promise<BeerPrice> => {
      const price = Number(r.price);
      if (!r.item?.trim() || !(price > 0 && price < 100)) throw new Error('Need a beer name and a price');
      const p: BeerPrice = {
        id: `user:${crypto.randomUUID()}`, venueId: r.venueId, item: r.item.trim().slice(0, 60), price: Math.round(price * 100) / 100,
        ...(r.currency === 'EUR' ? { currency: 'EUR' as const } : {}), // set from the place's location by the report form
        size: r.size, kind: r.kind, days: r.days, start: r.start, end: r.end, source: 'user', snippet: r.note?.trim() || undefined,
        reportedAt: new Date().toISOString(),
      };
      save('gib.beerReports', [...reports(), p]);
      return p;
    },
    removeReport: async (id: string) => { save('gib.beerReports', reports().filter((p) => p.id !== id)); return { ok: true }; },
  },
};

function nextMorning(): string {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

