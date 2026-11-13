import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync, createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, Mode, StoreOverride, UserProfile } from '@gib/shared';
import { config } from './config.ts';
import { DATA_DIR, repo } from './db.ts';
import { query, profileFor, type PersonalProfile } from './catalog.ts';
import { timingSafeEqual } from 'node:crypto';
import { isRefreshing, refreshAll } from './refresh.ts';
import { effectiveStore } from './pricing/engine.ts';
import { CITY_TAXES, CA_EXCISE_RATE, DEFAULT_CITY_TAX } from './pricing/taxes.ts';
import { sendMorningDigest } from './notify.ts';
import { morningJob, startScheduler } from './scheduler.ts';
import { SD_ZIPS } from './zips.ts';
import { getPublicUrl, startTunnel } from './tunnel.ts';
import './sources/register.ts';
import { randomUUID } from 'node:crypto';
import type { BeerPrice, BeerQuery, BeerReport } from '@gib/shared';
import { beerRepo } from './db.ts';
import { rankVenues } from './beer/rank.ts';
import { ensureArea, isBeerRefreshing, refreshBeer } from './beer/refresh.ts';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(here, '../../web/dist');
const APK_PATH = resolve(DATA_DIR, 'gibstaapp.apk');

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

// ---------- passcode (required for every API call when config.passcode is set) ----------
// Note: requests through Tailscale Funnel arrive from localhost, so localhost is NOT exempt.
let failures: number[] = [];
const passOk = (given: unknown) => {
  if (!config.passcode) return true;
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given.trim().toLowerCase()), b = Buffer.from(config.passcode.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
};
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth')) return;
  if (!passOk(req.headers['x-gib-pass'])) return reply.code(401).send({ error: 'passcode required' });
});
app.post('/api/auth', async (req, reply) => {
  const now = Date.now();
  failures = failures.filter((t) => now - t < 10 * 60_000);
  if (failures.length >= 20) return reply.code(429).send({ error: 'Too many wrong tries. Wait 10 minutes.' });
  const { pass } = (req.body ?? {}) as { pass?: string };
  if (passOk(pass)) return { ok: true, required: !!config.passcode };
  failures.push(now);
  await new Promise((r) => setTimeout(r, 800));
  return reply.code(401).send({ error: 'Wrong passcode' });
});

app.post('/api/items', async (req) => {
  const b = (req.body ?? {}) as { category?: Category; mode?: Mode; maxMiles?: number; search?: string; openNow?: boolean; limit?: number; profile?: Partial<PersonalProfile> };
  const profile = profileFor(b.profile);
  return query({
    category: b.category,
    mode: b.mode ?? 'pickup',
    maxMiles: b.maxMiles ?? profile.radiusMiles,
    search: b.search,
    openNow: !!b.openNow,
    limit: Math.min(b.limit ?? 200, 500),
  }, profile);
});

app.get('/api/stores', async () => {
  const overrides = new Map(repo.overrides().map((o) => [o.storeId, o]));
  return repo.stores().map((s) => ({ store: effectiveStore(s, overrides.get(s.id)), detected: s, override: overrides.get(s.id) ?? null }));
});

app.put('/api/stores/:id/override', async (req) => {
  const { id } = req.params as { id: string };
  const body = req.body as Partial<StoreOverride>;
  const o: StoreOverride = { storeId: id };
  for (const k of ['taxIncluded', 'ownSitePickup', 'hidden'] as const) if (k in body) (o as any)[k] = body[k];
  repo.setOverride(o);
  return o;
});

app.get('/api/profile', async () => repo.profile());

app.put('/api/profile', async (req, reply) => {
  const prev = repo.profile();
  const body = req.body as Partial<UserProfile>;
  const next: UserProfile = { ...prev, ...body };
  if (body.homeZip && body.homeZip !== prev.homeZip) {
    const z = SD_ZIPS[body.homeZip];
    if (!z) return reply.code(400).send({ error: `Unknown ZIP ${body.homeZip}. Supported: San Diego County ZIPs.` });
    next.lat = z.lat;
    next.lng = z.lng;
  }
  repo.setProfile(next);
  if (next.notifyHour !== prev.notifyHour) startScheduler();
  return next;
});

app.post('/api/profile/visited', async (req) => {
  const { storeId, visited } = req.body as { storeId: string; visited: boolean };
  const p = repo.profile();
  const set = new Set(p.visitedStoreIds);
  visited ? set.add(storeId) : set.delete(storeId);
  const next = { ...p, visitedStoreIds: [...set] };
  repo.setProfile(next);
  return next;
});

app.get('/api/zips', async () => SD_ZIPS);
app.get('/api/public-url', async () => ({ url: getPublicUrl() }));

app.get('/api/status', async () => ({ ...repo.refreshStatus(), running: isRefreshing() }));

const REFRESH_MIN_GAP_MS = 30 * 60_000;
app.post('/api/refresh', async () => {
  const st = repo.refreshStatus();
  const age = st.lastRefreshAt ? Date.now() - new Date(st.lastRefreshAt).getTime() : Infinity;
  if (!isRefreshing() && age < REFRESH_MIN_GAP_MS) {
    return { ...st, running: false, throttled: true, nextAllowedAt: new Date(Date.now() - age + REFRESH_MIN_GAP_MS).toISOString() };
  }
  refreshAll().catch((e) => console.error('[refresh]', e));
  return { ...st, running: true };
});

// ---------- beer ----------
app.post('/api/beer/venues', async (req) => {
  const q = (req.body ?? {}) as BeerQuery & { tzOffset?: number };
  const home = repo.profile();
  const lat = Number.isFinite(q.lat) ? q.lat : home.lat, lng = Number.isFinite(q.lng) ? q.lng : home.lng;
  // Somewhere new? Load the places around there first (OpenStreetMap, ~5-30 s the first time).
  let loading: string | null = null;
  try {
    await Promise.race([ensureArea(lat, lng, q.maxMiles ?? 10), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 60_000))]);
  } catch (e) {
    loading = (e as Error).message === 'slow' ? 'Still loading places for this area. Check back in a minute.' : `Couldn't load places here: ${(e as Error).message}`;
  }
  // Open/closed and happy hours use the phone's local time (matters when traveling).
  const shiftMin = Number.isFinite(q.tzOffset) ? new Date().getTimezoneOffset() - q.tzOffset! : 0;
  const now = new Date(Date.now() + shiftMin * 60_000);
  const venues = rankVenues({ ...q, lat, lng, limit: Math.min(q.limit ?? 150, 400) }, beerRepo.venues(), beerRepo.prices(), beerRepo.happyHours(), now);
  return { venues, loading };
});
app.get('/api/beer/status', async () => ({ ...beerRepo.status(), running: isBeerRefreshing(), venues: beerRepo.venues().length, areas: beerRepo.areas().length }));
app.post('/api/beer/refresh', async () => {
  const st = beerRepo.status();
  const age = st.lastRefreshAt ? Date.now() - new Date(st.lastRefreshAt).getTime() : Infinity;
  if (!isBeerRefreshing() && age < REFRESH_MIN_GAP_MS) {
    return { ...st, running: false, throttled: true, nextAllowedAt: new Date(Date.now() - age + REFRESH_MIN_GAP_MS).toISOString() };
  }
  refreshBeer().catch((e) => console.error('[beer refresh]', e));
  return { ...st, running: true };
});
/** Someone saw a price in person: save it (shown as "reported by a user"). */
app.post('/api/beer/report', async (req, reply) => {
  const b = (req.body ?? {}) as BeerReport;
  const price = Number(b.price);
  if (!b.venueId || !beerRepo.venues().some((v) => v.id === b.venueId)) return reply.code(400).send({ error: 'Unknown place' });
  if (!b.item?.trim() || !(price > 0 && price < 100)) return reply.code(400).send({ error: 'Need a beer name and a price' });
  const hhmm = /^\d{2}:\d{2}$/;
  const p: BeerPrice = {
    id: `user:${randomUUID()}`, venueId: b.venueId, item: b.item.trim().slice(0, 60), price: Math.round(price * 100) / 100,
    size: b.size?.trim().slice(0, 20) || undefined,
    kind: (['regular', 'happy_hour', 'special'] as const).includes(b.kind) ? b.kind : 'regular',
    days: Array.isArray(b.days) ? b.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : undefined,
    start: b.start && hhmm.test(b.start) ? b.start : undefined,
    end: b.end && hhmm.test(b.end) ? b.end : undefined,
    source: 'user', snippet: b.note?.trim().slice(0, 200) || undefined, reportedAt: new Date().toISOString(),
  };
  beerRepo.addPrice(p);
  return p;
});
app.delete('/api/beer/report/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!id.startsWith('user:')) return reply.code(400).send({ error: 'Only user reports can be removed here' });
  beerRepo.deletePrice(id);
  return { ok: true };
});

app.post('/api/notify/test', async () => sendMorningDigest());
app.post('/api/morning/run', async () => { await morningJob(); return { ok: true }; });

app.get('/api/taxes', async () => ({ exciseRate: CA_EXCISE_RATE, cities: CITY_TAXES, default: DEFAULT_CITY_TAX }));

app.get('/download', async (_req, reply) => {
  if (!existsSync(APK_PATH)) return reply.code(404).type('text/plain').send('APK not built yet. Run: npm run apk');
  reply.header('Content-Disposition', 'attachment; filename="gibstaapp.apk"');
  return reply.type('application/vnd.android.package-archive').send(createReadStream(APK_PATH));
});

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}

await app.listen({ port: config.port, host: config.host });
console.log(`Gibstaapp server on http://localhost:${config.port}`);
startScheduler();
startTunnel();

// First run: populate data right away.
if (repo.stores().length === 0) refreshAll().catch((e) => console.error('[refresh]', e));
if (beerRepo.venues().length === 0) refreshBeer().catch((e) => console.error('[beer refresh]', e));
