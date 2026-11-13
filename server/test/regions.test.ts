import { describe, expect, it } from 'vitest';
import { AREAS, ATHENS_POSTCODES, MAX_RESULT_MILES, NYC_ZIPS, REGIONS, REGION_ORDER, SD_ZIPS, distanceChoices, fmtDistance, fmtNear, regionAt, regionOf, weedRegionAt, type Product, type Store } from '@gib/shared';
import { DEFAULT_PROFILE } from '../src/db.ts';
import { computeTax } from '../src/pricing/taxes.ts';
import { mergeWeedStatus } from '../src/refresh.ts';
import { mergeWeed } from '../src/merge-weed.ts';
import { openState } from '../src/hours.ts';
import { ouncesOf, rankVenues } from '../src/beer/rank.ts';
import { loadSeed, mergeBeerStatus } from '../src/beer/refresh.ts';
import { dedupe } from '../src/beer/osm.ts';
import { haversineMiles, rankItems } from '../src/pricing/engine.ts';

describe('area codes', () => {
  it('San Diego, New York and Athens each under their own tab', () => {
    expect(Object.keys(SD_ZIPS).every((z) => AREAS[z].region === 'us')).toBe(true);
    expect(Object.keys(NYC_ZIPS).every((z) => AREAS[z].region === 'nyc')).toBe(true);
    expect(Object.keys(ATHENS_POSTCODES).every((z) => AREAS[z].region === 'europe')).toBe(true);
    expect(Object.keys(AREAS)).toHaveLength(Object.keys(SD_ZIPS).length + Object.keys(NYC_ZIPS).length + Object.keys(ATHENS_POSTCODES).length);
    expect(REGION_ORDER.map((r) => REGIONS[r].tab)).toEqual(['🌴 San Diego', '🗽 New York', '🇪🇺 Europe']);
  });
  it('New York ZIPs: five boroughs, real neighborhoods', () => {
    const zips = Object.entries(NYC_ZIPS);
    expect(zips.length).toBeGreaterThan(180);
    expect(new Set(zips.map(([, z]) => z.city))).toEqual(new Set(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']));
    for (const [code, z] of zips) {
      expect(code).toMatch(/^1(0[0-4]|1[0-6])\d\d$/);
      expect(regionAt(z).id).toBe('nyc');
    }
    expect(NYC_ZIPS['10014']).toMatchObject({ area: 'West Village', city: 'Manhattan' });
    expect(NYC_ZIPS['11211']).toMatchObject({ area: 'Williamsburg', city: 'Brooklyn' });
    expect(regionOf('10003')).toMatchObject({ id: 'nyc', currency: 'USD', units: 'mi', weedLegal: true, taxState: 'NY', timeZone: 'America/New_York' });
  });
  it('Athens postcodes look right and sit in greater Athens', () => {
    const codes = Object.entries(ATHENS_POSTCODES);
    expect(codes.length).toBeGreaterThan(200);
    const syntagma = { lat: 37.9755, lng: 23.7348 };
    for (const [code, a] of codes) {
      expect(code).toMatch(/^1[0-8]\d \d{2}$/);
      expect(a.area).toMatch(/^[\x20-\x7e]+$/); // readable in Latin letters
      expect(haversineMiles(syntagma.lat, syntagma.lng, a.lat, a.lng)).toBeLessThan(18);
    }
    expect(ATHENS_POSTCODES['105 58']).toMatchObject({ area: 'Plaka', city: 'Athens' });
    expect(ATHENS_POSTCODES['106 76']).toMatchObject({ area: 'Kolonaki', city: 'Athens' });
  });
  it('regionOf', () => {
    expect(regionOf('92122')).toMatchObject({ id: 'us', currency: 'USD', units: 'mi', weedLegal: true });
    expect(regionOf('105 58')).toMatchObject({ id: 'europe', city: 'Athens', currency: 'EUR', units: 'km', weedLegal: false });
    expect(regionOf(undefined).id).toBe('us');
    expect(regionOf('nope').id).toBe('us');
  });
});

describe('units', () => {
  it('miles in the U.S., kilometres in Europe', () => {
    expect(fmtDistance(4.3, 'mi')).toBe('4.3 mi');
    expect(fmtDistance(4.3, 'km')).toBe('6.9 km');
    expect(fmtNear(0.05, 'mi')).toBe('264 ft');
    expect(fmtNear(0.2, 'km')).toBe('322 m');
    expect(fmtNear(20, 'km')).toBe('32 km');
    const km = distanceChoices('km', [1], [1, 5]);
    expect(km.map(([, label]) => label)).toEqual(['≤ 1 km', '≤ 5 km']);
    expect(km[1][0]).toBeCloseTo(3.107, 3); // stored in miles
  });
});

describe('beer in Athens', () => {
  it('Greek public holidays apply to places in Greece', () => {
    const athens = { lat: 37.97, lng: 23.73 };
    const easterMonday2026 = new Date(2026, 3, 13, 14); // Greek Orthodox Easter Monday
    expect(openState('Mo-Su 10:00-23:00; PH off', easterMonday2026, athens).isOpen).toBe(false);
    expect(openState('Mo-Su 10:00-23:00; PH off', easterMonday2026).isOpen).toBe(true); // not a U.S. holiday
  });
  it('bars in Greece are judged on Athens time, wherever the phone is', () => {
    const bar = { id: 'osm:2', name: 'Μπυραρία', kind: 'bar' as const, lat: 37.97, lng: 23.73, source: 'osm' as const, openingHours: 'Mo-Su 18:00-02:00' };
    const instant = new Date('2026-11-13T17:33:00Z'); // 7:33 PM in Athens, 9:33 AM in San Diego
    const phoneInSanDiego = new Date(2026, 10, 13, 9, 33);
    const [r] = rankVenues({ lat: 37.97, lng: 23.73 }, [bar], [], [], phoneInSanDiego, instant);
    expect(r).toMatchObject({ isOpen: true, hoursLabel: 'Open until 2 AM' });
  });
  it('Greek names are not merged as duplicates', () => {
    const v = (id: string, name: string) => ({ id, name, kind: 'bar' as const, lat: 37.97, lng: 23.73, source: 'osm' as const });
    expect(dedupe([v('a', 'Θέσις 7'), v('b', 'Μπυραρία'), v('c', 'Μπυραρία')]).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('euro prices stay euros', () => {
    const venue = { id: 'osm:1', name: 'Bar', kind: 'bar' as const, lat: 37.97, lng: 23.73, source: 'osm' as const };
    const price = { id: 'u1', venueId: 'osm:1', item: 'Mythos', price: 4.5, currency: 'EUR' as const, kind: 'regular' as const, source: 'user' as const, reportedAt: new Date().toISOString() };
    const [r] = rankVenues({ lat: 37.97, lng: 23.73 }, [venue], [price], []);
    expect(r.best).toMatchObject({ price: 4.5, currency: 'EUR' });
  });
});

describe('metric sizes', () => {
  it('ml / cl / l', () => {
    expect(ouncesOf('500ml')).toBeCloseTo(16.91, 2);
    expect(ouncesOf('330ml')).toBeCloseTo(11.16, 2);
    expect(ouncesOf('33cl')).toBeCloseTo(11.16, 2);
    expect(ouncesOf('0,5 L')).toBeCloseTo(16.91, 2);
    expect(ouncesOf('6-pack 330ml')).toBeCloseTo(66.96, 1);
    expect(ouncesOf('pint')).toBe(16);
    expect(ouncesOf('12oz')).toBe(12);
  });
});

describe('Athens deals in beer-seed.json', () => {
  it('every entry finds its place, in euros, with a source link and the date checked', () => {
    const places = [
      { id: 'osm:node/4460648896', name: 'Barrett', kind: 'bar' as const, lat: 37.9780769, lng: 23.7256085, source: 'osm' as const },
      { id: 'osm:node/5642451768', name: 'Tapfield', kind: 'bar' as const, lat: 37.9781445, lng: 23.7232344, source: 'osm' as const },
      { id: 'osm:node/11467013291', name: 'Padre', kind: 'bar' as const, lat: 37.9868458, lng: 23.733974, source: 'osm' as const },
      { id: 'osm:node/1', name: 'Barrett', kind: 'bar' as const, lat: 32.7, lng: -117.1, source: 'osm' as const }, // a namesake in San Diego
    ];
    const seed = loadSeed(places);
    const athens = seed.prices.filter((p) => p.currency === 'EUR');
    expect(athens.length).toBeGreaterThanOrEqual(9);
    for (const p of athens) {
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.snippet).toBeTruthy();
      expect(p.reportedAt).toBe('2026-11-13T12:00:00.000Z');
      expect(p.venueId).not.toBe('osm:node/1');
    }
    expect(seed.venues.map((v) => v.name)).toEqual(expect.arrayContaining(['Berlin by 5 Drunkmen', 'Hard Rock Cafe Athens']));
    expect(seed.happyHours.map((h) => `${h.start}-${h.end}`)).toEqual(['16:00-18:00', '22:00-23:00']);
  });
});

describe('San Diego and Athens stay apart', () => {
  const plaka = AREAS['105 58'], uc = AREAS['92122'];
  const bar = (id: string, lat: number, lng: number) => ({ id, name: id, kind: 'bar' as const, lat, lng, source: 'osm' as const });
  const sdBar = bar('sd', 32.85, -117.2), athensBar = bar('ath', 37.976, 23.726), oceanside = bar('far-sd', 33.2, -117.38), lasVegas = bar('vegas', 36.17, -115.14);
  it('beer: nothing more than 100 mi from the home area code', () => {
    const all = [sdBar, athensBar, oceanside, lasVegas];
    // Home in Athens, even if the search point is San Diego: only Athens bars, never San Diego ones.
    expect(rankVenues({ lat: uc.lat, lng: uc.lng, home: plaka }, all, [], []).map((r) => r.venue.id)).toEqual(['ath']);
    expect(rankVenues({ lat: plaka.lat, lng: plaka.lng, home: plaka }, all, [], []).map((r) => r.venue.id)).toEqual(['ath']);
    // Home in San Diego: San Diego County yes, Las Vegas (~250 mi) and Athens no.
    expect(rankVenues({ lat: uc.lat, lng: uc.lng, home: uc }, all, [], []).map((r) => r.venue.id).sort()).toEqual(['far-sd', 'sd']);
    expect(MAX_RESULT_MILES).toBe(100);
  });
  it('weed: no store more than 100 mi from home, delivery included', () => {
    const store = (id: string, lat: number, lng: number): Store => ({ id, name: id, address: '1 Main St', city: 'X', lat, lng, sources: [{ source: 'sample', externalId: id }],
      pickup: true, ownSitePickup: null, taxIncluded: true, delivery: [{ via: 'store', fee: 0, minimum: 0 }] });
    const product = (storeId: string): Product => ({ id: `${storeId}:p`, storeId, source: 'sample', name: 'Blue Dream 3.5g', category: 'flower', grams: 3.5, price: 30 });
    const stores = new Map([['near', store('near', 32.86, -117.2)], ['vegas', store('vegas', 36.17, -115.14)]]);
    const products = [product('near'), product('vegas')];
    for (const mode of ['pickup', 'delivery'] as const) {
      expect(rankItems(products, stores, [], new Map(), DEFAULT_PROFILE, { mode, maxMiles: 500 }).map((i) => i.store.id)).toEqual(['near']);
    }
  });
  it('Athens prices are always euros; a dollar price on a Greek website is dropped', () => {
    const p = (id: string, price: number, currency?: 'EUR') => ({ id, venueId: 'ath', item: 'Draft', price, ...(currency ? { currency } : {}), kind: 'regular' as const, source: 'website' as const, reportedAt: '2026-11-13' });
    const [r] = rankVenues({ lat: plaka.lat, lng: plaka.lng, home: plaka }, [athensBar], [p('usd', 3), p('eur', 5, 'EUR')], []);
    expect(r.prices.map((x) => x.id)).toEqual(['eur']);
    expect(r.best).toMatchObject({ price: 5, currency: 'EUR' });
    expect(regionAt(athensBar).currency).toBe('EUR');
    expect(regionAt(sdBar).currency).toBe('USD');
  });
});

describe('separate daily refreshes: San Diego ($) and Athens (€)', () => {
  const line = (source: any, finishedAt: string, ok = true) => ({ source, ok, stores: 1, products: 1, finishedAt });
  const prev = { running: false, lastRefreshAt: '2026-11-13T14:00:00Z', sources: [line('osm', '2026-11-13T14:00:00Z'), line('bar-websites', '2026-11-13T14:01:00Z'), line('athens-places', '2026-11-13T05:00:00Z'), line('athens-menus', '2026-11-13T05:01:00Z')] };
  it("Athens' refresh replaces only Athens' status lines", () => {
    const next = mergeBeerStatus(prev, 'europe', [line('athens-places', '2026-11-14T05:00:00Z'), line('athens-menus', '2026-11-14T05:02:00Z', false)], false);
    expect(next.sources.find((s) => s.source === 'osm')!.finishedAt).toBe('2026-11-13T14:00:00Z');
    expect(next.sources.find((s) => s.source === 'bar-websites')!.ok).toBe(true);
    expect(next.sources.find((s) => s.source === 'athens-menus')).toMatchObject({ ok: false, finishedAt: '2026-11-14T05:02:00Z' });
    expect(next.sources).toHaveLength(4);
  });
  it("San Diego's refresh leaves Athens alone", () => {
    const next = mergeBeerStatus(prev, 'us', [line('osm', '2026-11-14T14:00:00Z'), line('bar-websites', '2026-11-14T14:03:00Z')], false);
    expect(next.sources.filter((s) => s.source.startsWith('athens')).map((s) => s.finishedAt)).toEqual(['2026-11-13T05:00:00Z', '2026-11-13T05:01:00Z']);
  });
  it('starting a refresh only marks it running', () => {
    expect(mergeBeerStatus(prev, 'us', null, true)).toMatchObject({ running: true, sources: prev.sources });
  });
});

describe('New York', () => {
  it('cannabis tax: 9% state + 4% local, no sales tax', () => {
    expect(computeTax(100, 'New York', 0, false, 'NY')).toMatchObject({ excise: 9, local: 4, sales: 0, total: 13, included: false });
    expect(computeTax(100, 'San Diego', 0, false, 'CA').total).toBeGreaterThan(30); // California is still California
    expect(computeTax(100, 'New York', 0, true, 'NY')).toMatchObject({ total: 0, included: true });
  });
  it('a New York store is taxed the New York way', () => {
    const store = { id: 'ny', name: 'NY shop', address: '1 Broadway', city: 'New York', lat: 40.73, lng: -73.99, sources: [{ source: 'jane' as const, externalId: '1' }], pickup: true, ownSitePickup: null, taxIncluded: false, delivery: [] };
    const item = rankItems([{ id: 'p', storeId: 'ny', source: 'jane', name: 'Flower 3.5g', category: 'flower', grams: 3.5, price: 40 }], new Map([['ny', store]]), [], new Map(), { ...DEFAULT_PROFILE, lat: 40.73, lng: -73.99 }, { mode: 'pickup' })[0];
    expect(item.tax).toMatchObject({ excise: 3.6, local: 1.6, sales: 0, total: 5.2 });
    expect(item.otd).toBe(45.2);
  });
  it("one city's weed refresh never touches the other's status lines", () => {
    const line = (source: any, region: any, finishedAt: string) => ({ source, region, ok: true, stores: 1, products: 1, finishedAt });
    const prev = { running: false, sources: [{ source: 'jane' as const, ok: true, stores: 1, products: 1, finishedAt: '2026-11-13T13:00:00Z' }, line('jane', 'nyc', '2026-11-13T12:00:00Z')] };
    const next = mergeWeedStatus(prev, 'nyc', [line('jane', 'nyc', '2026-11-14T12:00:00Z'), line('weedmaps', 'nyc', '2026-11-14T12:01:00Z')], false);
    expect(next.sources.filter((s) => !s.region).map((s) => s.finishedAt)).toEqual(['2026-11-13T13:00:00Z']); // San Diego's (old, no region) kept
    expect(next.sources.filter((s) => s.region === 'nyc')).toHaveLength(2);
  });
  it('website data merges per source and per city', () => {
    const st = (id: string, lat: number, lng: number) => ({ id, name: id, address: '1 Main St', city: 'X', lat, lng, sources: [{ source: 'jane' as const, externalId: id }], pickup: true, ownSitePickup: null, taxIncluded: null, delivery: [] });
    const p = (storeId: string) => ({ id: storeId + ':p', storeId, source: 'jane' as const, name: 'Flower 3.5g', category: 'flower' as const, grams: 3.5, price: 30 });
    // Yesterday's snapshot has San Diego; today's New York-only run has New York. Both survive.
    const sd = { stores: [st('sd', 32.85, -117.2)], products: [p('sd')], deals: [], status: { running: false, sources: [{ source: 'jane' as const, ok: true, stores: 1, products: 1, finishedAt: '2026-11-13T13:00:00Z' }] } };
    const ny = { stores: [st('ny', 40.73, -73.99)], products: [p('ny')], deals: [], status: { running: false, sources: [{ source: 'jane' as const, region: 'nyc' as const, ok: true, stores: 1, products: 1, finishedAt: '2026-11-14T12:00:00Z' }] } };
    const m = mergeWeed([sd, ny])!;
    expect(m.stores.map((s) => s.id).sort()).toEqual(['ny', 'sd']);
    expect(m.products).toHaveLength(2);
  });
});

describe('New York weed list is New York State only', () => {
  // Real shops from the first live New York run, plus well-known spots either side of the Hudson and the Kills.
  const ny: [string, number, number][] = [
    ['Hii NYC, Williamsburg', 40.719, -73.957], ['Flynnstoned Chelsea', 40.744, -73.999], ['Flynnstoned Staten Island', 40.629, -74.114],
    ['Flynnstoned Bay Ridge', 40.625, -74.025], ['Battery Park City', 40.711, -74.016], ['Hudson Yards', 40.754, -74.002],
    ['Inwood', 40.868, -73.92], ['Riverside Dr / 116th', 40.80, -73.968], ['Riverdale', 40.89, -73.91], ['Yonkers', 40.93, -73.89],
    ['St. George, Staten Island', 40.643, -74.077], ['Travis, Staten Island', 40.59, -74.19], ['Tottenville', 40.512, -74.24],
    ['Nyack', 41.09, -73.92], ['White Plains', 41.03, -73.76], ['Mineola, Long Island', 40.75, -73.64], ['Rockaway Park', 40.58, -73.84],
  ];
  const notNy: [string, number, number][] = [
    ['RISE Paramus NJ', 40.918, -74.059], ['RISE Bloomfield NJ', 40.776, -74.187], ['Gardens Garfield NJ', 40.876, -74.115],
    ['RISE Paterson NJ', 40.938, -74.149], ['Maplewood NJ', 40.731, -74.279], ['Jersey City', 40.716, -74.04], ['Hoboken', 40.744, -74.03],
    ['Fort Lee', 40.85, -73.97], ['Bayonne', 40.67, -74.11], ['Elizabeth', 40.66, -74.21], ['Perth Amboy', 40.507, -74.27],
    ['Mahwah', 41.09, -74.15], ['Sandy Hook', 40.45, -74.0], ['Greenwich CT', 41.03, -73.62], ['Stamford CT', 41.05, -73.54],
  ];
  it.each(ny)('%s is in the New York list', (_n, lat, lng) => expect(weedRegionAt({ lat, lng })).toBe('nyc'));
  it.each(notNy)('%s is left out', (_n, lat, lng) => expect(weedRegionAt({ lat, lng })).toBeNull());
  it('bars across the river still count as the New York area for beer', () => expect(regionAt({ lat: 40.744, lng: -74.03 }).id).toBe('nyc'));
  it('San Diego and Athens are unchanged', () => {
    expect(weedRegionAt({ lat: 32.75, lng: -117.2 })).toBe('us');
    expect(weedRegionAt({ lat: 37.98, lng: 23.73 })).toBe('europe');
  });
  it('the merge drops New Jersey shops from old data', () => {
    const store = (id: string, lat: number, lng: number) => ({ id, name: id, address: '', city: '', lat, lng, sources: [{ source: 'weedmaps', externalId: id }], pickup: true, ownSitePickup: null, taxIncluded: null, delivery: [] }) as Store;
    const product = (id: string, storeId: string) => ({ id, storeId, source: 'weedmaps', name: id, category: 'flower', price: 20, grams: 3.5 }) as unknown as Product;
    const snap = { stores: [store('nyc', 40.719, -73.957), store('nj', 40.918, -74.059)], products: [product('a', 'nyc'), product('b', 'nj')], deals: [],
      status: { running: false, sources: [{ source: 'weedmaps' as const, region: 'nyc' as const, ok: true, stores: 2, products: 2, finishedAt: '2026-11-13T00:00:00Z' }] } };
    const m = mergeWeed([snap])!;
    expect(m.stores.map((s) => s.id)).toEqual(['nyc']);
  });
});
