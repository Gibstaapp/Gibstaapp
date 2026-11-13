import { describe, expect, it } from 'vitest';
import { AREAS, ATHENS_POSTCODES, SD_ZIPS, distanceChoices, fmtDistance, fmtNear, regionOf } from '@gib/shared';
import { openState } from '../src/hours.ts';
import { ouncesOf, rankVenues } from '../src/beer/rank.ts';
import { loadSeed } from '../src/beer/refresh.ts';
import { dedupe } from '../src/beer/osm.ts';
import { haversineMiles } from '../src/pricing/engine.ts';

describe('area codes', () => {
  it('San Diego ZIPs are under the U.S. tab, Athens postcodes under Europe', () => {
    expect(Object.keys(SD_ZIPS).every((z) => AREAS[z].region === 'us')).toBe(true);
    expect(Object.keys(ATHENS_POSTCODES).every((z) => AREAS[z].region === 'europe')).toBe(true);
    expect(Object.keys(AREAS)).toHaveLength(Object.keys(SD_ZIPS).length + Object.keys(ATHENS_POSTCODES).length);
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
