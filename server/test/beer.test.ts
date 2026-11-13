import { describe, expect, it } from 'vitest';
import type { BeerPrice, BeerVenue } from '@gib/shared';
import { extractHappyHour, parseDays, parsePrices, parseTimeRange } from '../src/beer/extract.ts';
import { bearingDegrees, openState, windowActive } from '../src/beer/hours.ts';
import { ouncesOf, perPint, rankVenues } from '../src/beer/rank.ts';
import { kindOf, toVenue } from '../src/beer/osm.ts';

// Local-time dates (server runs in Pacific time).
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const WED_4PM = at(2026, 11, 11, 16); // Wednesday
const WED_8PM = at(2026, 11, 11, 20);
const SAT_1AM = at(2026, 11, 14, 1);  // early Saturday (Friday night)

describe('parseDays', () => {
  it('ranges, weekdays, daily, singles', () => {
    expect(parseDays('Monday - Friday')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('Mon–Thu')).toEqual([1, 2, 3, 4]);
    expect(parseDays('Fri thru Sun')).toEqual([5, 6, 0]);
    expect(parseDays('weekdays only')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseDays('Tuesday and Thursday')).toEqual([2, 4]);
    expect(parseDays('nothing here')).toBeNull();
  });
});

describe('parseTimeRange', () => {
  it('handles the usual ways bars write it', () => {
    expect(parseTimeRange('3-6pm')).toEqual({ start: '15:00', end: '18:00' });
    expect(parseTimeRange('3:00 PM – 6:00 PM')).toEqual({ start: '15:00', end: '18:00' });
    expect(parseTimeRange('2 to 5')).toEqual({ start: '14:00', end: '17:00' });
    expect(parseTimeRange('11am - 1pm')).toEqual({ start: '11:00', end: '13:00' });
    expect(parseTimeRange('10pm to close')).toEqual({ start: '22:00', end: '02:00' });
  });
  it('rejects non-times', () => {
    expect(parseTimeRange('call 619-555-1234')).toBeNull();
  });
});

describe('parsePrices', () => {
  it('finds beer prices and skips food, pitchers and "$ off"', () => {
    const p = parsePrices('$5 drafts, $4 domestic pints, $6 wings, $15 pitchers, $2 off all beers', true);
    expect(p.map((x) => [x.item, x.price])).toEqual([['Drafts', 5], ['Domestic pints', 4]]);
    expect(p[1].size).toBe('pint');
  });
  it('price after the name', () => {
    expect(parsePrices('Coors Light - $3.50', false)[0]).toMatchObject({ item: 'Coors Light', price: 3.5 });
  });
});

describe('extractHappyHour', () => {
  it('pulls window + prices from a typical page', () => {
    const r = extractHappyHour('Welcome! HAPPY HOUR Monday - Friday 3pm - 6pm. $5 drafts and $7 wells. Live music Sat.');
    expect(r.windows[0]).toMatchObject({ days: [1, 2, 3, 4, 5], start: '15:00', end: '18:00' });
    expect(r.prices.map((p) => p.price)).toEqual([5]);
  });
});

describe('hours', () => {
  it('opening_hours state and past-midnight windows', () => {
    expect(openState('Mo-Su 11:00-02:00', WED_4PM).isOpen).toBe(true);
    expect(openState('Mo-Su 11:00-02:00', SAT_1AM).isOpen).toBe(true);
    expect(openState('Mo-Fr 11:00-15:00', WED_4PM).isOpen).toBe(false);
    expect(openState(undefined).isOpen).toBeNull();
    expect(openState('garbage %%').isOpen).toBeNull();
    expect(windowActive({ days: [3], start: '15:00', end: '18:00' }, WED_4PM)).toBe(true);
    expect(windowActive({ days: [3], start: '15:00', end: '18:00' }, WED_8PM)).toBe(false);
    expect(windowActive({ days: [5], start: '22:00', end: '02:00' }, SAT_1AM)).toBe(true); // Friday's late window
  });
  it('bearing cardinal directions', () => {
    expect(bearingDegrees(32, -117, 33, -117)).toBeCloseTo(0, 1);
    expect(bearingDegrees(32, -117, 32, -116)).toBeCloseTo(89.7, 0);
    expect(bearingDegrees(32, -117, 31, -117)).toBeCloseTo(180, 1);
  });
});

describe('ranking', () => {
  const v = (id: string, lat: number, kind: BeerVenue['kind'] = 'bar', openingHours = 'Mo-Su 10:00-02:00'): BeerVenue =>
    ({ id, name: id, kind, lat, lng: -117.2, openingHours, source: 'osm' });
  const price = (venueId: string, p: number, extra: Partial<BeerPrice> = {}): BeerPrice =>
    ({ id: `${venueId}:${p}`, venueId, item: 'Draft', price: p, kind: 'regular', source: 'user', reportedAt: '', ...extra });
  const venues = [v('near', 32.851), v('far', 32.95), v('store', 32.86, 'store'), v('closed', 32.852, 'bar', 'Mo-Su 06:00-07:00')];

  it('sizes', () => {
    expect(ouncesOf('6-pack')).toBe(72);
    expect(ouncesOf('24oz')).toBe(24);
    expect(perPint({ price: 3, size: '12oz' })).toBe(4);
  });

  it('happy hour applies only in its window', () => {
    const prices = [price('near', 8), price('near', 5, { kind: 'happy_hour', days: [3], start: '15:00', end: '18:00' })];
    const q = { lat: 32.85, lng: -117.2 };
    expect(rankVenues(q, venues, prices, [], WED_4PM).find((r) => r.venue.id === 'near')!.best!.price).toBe(5);
    expect(rankVenues(q, venues, prices, [], WED_8PM).find((r) => r.venue.id === 'near')!.best!.price).toBe(8);
  });

  it('sorts: closest, cheapest (per pint), closed last, kind + openNow filters', () => {
    const prices = [price('near', 9), price('far', 5), price('store', 2.25, { size: '12oz' })];
    const q = { lat: 32.85, lng: -117.2 };
    expect(rankVenues({ ...q, sort: 'closest' }, venues, prices, [], WED_4PM).map((r) => r.venue.id)).toEqual(['near', 'store', 'far', 'closed']);
    expect(rankVenues({ ...q, sort: 'cheapest' }, venues, prices, [], WED_4PM).map((r) => r.venue.id).slice(0, 3)).toEqual(['store', 'far', 'near']);
    expect(rankVenues({ ...q, kind: 'store' }, venues, prices, [], WED_4PM).map((r) => r.venue.id)).toEqual(['store']);
    expect(rankVenues({ ...q, openNow: true }, venues, prices, [], WED_4PM).some((r) => r.venue.id === 'closed')).toBe(false);
  });
});

describe('osm', () => {
  it('maps tags to venues', () => {
    expect(kindOf({ amenity: 'bar', name: 'Ballast Point Brewing' })).toBe('brewery');
    expect(kindOf({ shop: 'alcohol', name: 'BevMo' })).toBe('store');
    const venue = toVenue({ type: 'node', id: 1, lat: 32.7, lon: -117.1, tags: { amenity: 'pub', name: 'The Pub', website: 'thepub.com', 'addr:housenumber': '1', 'addr:street': 'Main St', 'addr:city': 'San Diego' } });
    expect(venue).toMatchObject({ id: 'osm:node/1', kind: 'bar', website: 'https://thepub.com', address: '1 Main St, San Diego' });
    expect(toVenue({ type: 'node', id: 2, lat: 1, lon: 1, tags: { amenity: 'bar' } })).toBeNull();
  });
});
