import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BeerPrice, BeerVenue, Deal, HappyHour, Product, RefreshStatus, Store, StoreOverride, UserProfile } from '@gib/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, '../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(process.env.GIB_DB ?? resolve(DATA_DIR, 'gibstaapp.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS stores    (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS products  (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS deals     (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS overrides (store_id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kv        (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots (taken_at TEXT NOT NULL, product_id TEXT NOT NULL, otd REAL NOT NULL, per_unit REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS beer_venues (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS beer_prices (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, source TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS beer_happy_hours (venue_id TEXT NOT NULL, source TEXT NOT NULL, json TEXT NOT NULL);
`);

const parseAll = <T>(rows: unknown[]): T[] => rows.map((r) => JSON.parse((r as { json: string }).json) as T);

export const DEFAULT_PROFILE: UserProfile = {
  homeZip: '92122',
  lat: 32.8566,     // University City, San Diego
  lng: -117.2091,
  radiusMiles: 30,
  veteran: false,
  senior: false,
  student: false,
  visitedStoreIds: [],
  onboarded: false,
  notifyHour: 7,
};

function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT json FROM kv WHERE key = ?').get(key) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as T) : undefined;
}
function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(value));
}

export const repo = {
  stores: (): Store[] => parseAll(db.prepare('SELECT json FROM stores').all()),
  products: (): Product[] => parseAll(db.prepare('SELECT json FROM products').all()),
  deals: (): Deal[] => parseAll(db.prepare('SELECT json FROM deals').all()),
  overrides: (): StoreOverride[] => parseAll(db.prepare('SELECT json FROM overrides').all()),

  /** Replace the whole catalog in one transaction (called after a refresh merges all sources). */
  replaceCatalog(stores: Store[], products: Product[], deals: Deal[]) {
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM stores; DELETE FROM products; DELETE FROM deals;');
      const s = db.prepare('INSERT INTO stores (id, json) VALUES (?, ?)');
      for (const x of stores) s.run(x.id, JSON.stringify(x));
      const p = db.prepare('INSERT OR REPLACE INTO products (id, store_id, json) VALUES (?, ?, ?)');
      for (const x of products) p.run(x.id, x.storeId, JSON.stringify(x));
      const d = db.prepare('INSERT OR REPLACE INTO deals (id, store_id, json) VALUES (?, ?, ?)');
      for (const x of deals) d.run(x.id, x.storeId, JSON.stringify(x));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  setOverride(o: StoreOverride) {
    db.prepare('INSERT INTO overrides (store_id, json) VALUES (?, ?) ON CONFLICT(store_id) DO UPDATE SET json = excluded.json').run(o.storeId, JSON.stringify(o));
  },

  profile: (): UserProfile => ({ ...DEFAULT_PROFILE, ...kvGet<Partial<UserProfile>>('profile') }),
  setProfile(p: UserProfile) { kvSet('profile', p); },

  refreshStatus: (): RefreshStatus => kvGet<RefreshStatus>('refreshStatus') ?? { running: false, sources: [] },
  setRefreshStatus(s: RefreshStatus) { kvSet('refreshStatus', s); },

  /** Keep a daily price history so we can show "lowest in 30 days" later. */
  snapshot(rows: { productId: string; otd: number; perUnit: number }[]) {
    const now = new Date().toISOString();
    const st = db.prepare('INSERT INTO snapshots (taken_at, product_id, otd, per_unit) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    for (const r of rows) st.run(now, r.productId, r.otd, r.perUnit);
    db.exec('COMMIT');
    db.prepare("DELETE FROM snapshots WHERE taken_at < datetime('now', '-90 days')").run();
  },
};

// ---- beer ----
function tx(fn: () => void) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export interface BeerArea { lat: number; lng: number; miles: number; fetchedAt: string; usedAt: string; crawledAt?: string }

export const beerRepo = {
  venues: (): BeerVenue[] => parseAll(db.prepare('SELECT json FROM beer_venues').all()),
  prices: (): BeerPrice[] => parseAll(db.prepare('SELECT json FROM beer_prices').all()),
  happyHours: (): HappyHour[] => parseAll(db.prepare('SELECT json FROM beer_happy_hours').all()),

  /** Add/update places (we keep places from every area anyone has looked at). */
  upsertVenues(venues: BeerVenue[]) {
    tx(() => {
      const st = db.prepare('INSERT OR REPLACE INTO beer_venues (id, json) VALUES (?, ?)');
      for (const v of venues) st.run(v.id, JSON.stringify(v));
    });
  },
  /** Replace website-found data for just these places (used when crawling one area). */
  replaceWebsiteFor(venueIds: string[], prices: BeerPrice[], happyHours: HappyHour[]) {
    tx(() => {
      const dp = db.prepare("DELETE FROM beer_prices WHERE source = 'website' AND venue_id = ?");
      const dh = db.prepare("DELETE FROM beer_happy_hours WHERE source = 'website' AND venue_id = ?");
      for (const id of venueIds) { dp.run(id); dh.run(id); }
      const p = db.prepare('INSERT OR REPLACE INTO beer_prices (id, venue_id, source, json) VALUES (?, ?, ?, ?)');
      for (const x of prices) p.run(x.id, x.venueId, x.source, JSON.stringify(x));
      const h = db.prepare('INSERT INTO beer_happy_hours (venue_id, source, json) VALUES (?, ?, ?)');
      for (const x of happyHours) h.run(x.venueId, x.source, JSON.stringify(x));
    });
  },
  /** Areas we've loaded places for: center + radius in miles. */
  areas: (): BeerArea[] => kvGet<BeerArea[]>('beerAreas') ?? [],
  setAreas(a: BeerArea[]) { kvSet('beerAreas', a); },
  /** Replace everything from one automatic source ('website' | 'seed'); user reports are never wiped. */
  replaceFromSource(sources: ('website' | 'seed' | 'team')[], prices: BeerPrice[], happyHours: HappyHour[]) {
    tx(() => {
      for (const source of sources) {
        db.prepare('DELETE FROM beer_prices WHERE source = ?').run(source);
        db.prepare('DELETE FROM beer_happy_hours WHERE source = ?').run(source);
      }
      const p = db.prepare('INSERT OR REPLACE INTO beer_prices (id, venue_id, source, json) VALUES (?, ?, ?, ?)');
      for (const x of prices) p.run(x.id, x.venueId, x.source, JSON.stringify(x));
      const h = db.prepare('INSERT INTO beer_happy_hours (venue_id, source, json) VALUES (?, ?, ?)');
      for (const x of happyHours) h.run(x.venueId, x.source, JSON.stringify(x));
    });
  },
  addPrice(p: BeerPrice) {
    db.prepare('INSERT OR REPLACE INTO beer_prices (id, venue_id, source, json) VALUES (?, ?, ?, ?)').run(p.id, p.venueId, p.source, JSON.stringify(p));
  },
  deletePrice(id: string) { db.prepare('DELETE FROM beer_prices WHERE id = ?').run(id); },

  status: (): RefreshStatus => kvGet<RefreshStatus>('beerStatus') ?? { running: false, sources: [] },
  setStatus(s: RefreshStatus) { kvSet('beerStatus', s); },
};
