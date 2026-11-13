import { describe, expect, it } from 'vitest';
import type { BeerVenue, Product, Store } from '@gib/shared';
import { openState, to24h, weeklyHoursToOsm } from '../src/hours.ts';
import { rankVenues } from '../src/beer/rank.ts';
import { mergeResults } from '../src/normalize.ts';
import { rankItems } from '../src/pricing/engine.ts';
import { DEFAULT_PROFILE } from '../src/db.ts';

// Local-time dates (server runs in Pacific time).
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const WED = (h: number, mi = 0) => at(2026, 11, 11, h, mi); // Wednesday

describe('openState', () => {
  it('open, closing soon, closed, unknown', () => {
    expect(openState('Mo-Su 08:00-22:00', WED(16))).toMatchObject({ isOpen: true, label: 'Open until 10 PM' });
    expect(openState('Mo-Su 08:00-22:00', WED(16)).closingSoon).toBeUndefined();
    expect(openState('Mo-Su 08:00-22:00', WED(21, 15))).toMatchObject({ isOpen: true, closingSoon: true, label: 'Closes 10 PM' });
    expect(openState('Mo-Su 08:00-22:00', WED(23))).toMatchObject({ isOpen: false, label: 'Opens 8 AM' });
    expect(openState(undefined)).toEqual({ isOpen: null });
    expect(openState('24/7')).toMatchObject({ isOpen: true, label: 'Open 24/7' });
  });
  it('past-midnight hours count as open late at night', () => {
    expect(openState('Mo-Su 11:00-02:00', WED(23, 30))).toMatchObject({ isOpen: true, label: 'Open until 2 AM' });
    expect(openState('Mo-Su 11:00-02:00', at(2026, 11, 12, 1, 30))).toMatchObject({ isOpen: true, closingSoon: true });
  });
});

describe('weekly hours from listing sites', () => {
  it('12-hour times', () => {
    expect(to24h('6:00am')).toBe('06:00');
    expect(to24h(' 9:55pm')).toBe('21:55');
    expect(to24h('12:00am')).toBe('00:00');
    expect(to24h('12:30 PM')).toBe('12:30');
    expect(to24h('noon-ish')).toBeNull();
  });
  it('Weedmaps business_hours -> opening_hours that works', () => {
    const day = { open: '6:00am', close: '9:55pm' };
    const text = weeklyHoursToOsm({ monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: { open: '8:00am', close: '2:00am' }, sunday: { is_closed: true } });
    expect(text).toBe('Mo 06:00-21:55; Tu 06:00-21:55; We 06:00-21:55; Th 06:00-21:55; Fr 06:00-21:55; Sa 08:00-02:00');
    expect(openState(text, WED(12)).isOpen).toBe(true);
    expect(openState(text, WED(22)).isOpen).toBe(false);
    expect(openState(text, at(2026, 11, 15, 1)).isOpen).toBe(true); // Saturday night, past midnight
    expect(openState(text, at(2026, 11, 15, 12)).isOpen).toBe(false); // Sunday: closed
  });
  it('midnight close and all-day', () => {
    expect(weeklyHoursToOsm({ monday: { open: '8:00am', close: '12:00am' } })).toBe('Mo 08:00-24:00');
    expect(weeklyHoursToOsm({ monday: { open: '12:00am', close: '12:00am' } })).toBe('Mo 00:00-24:00');
  });
  it('nothing usable -> undefined', () => {
    expect(weeklyHoursToOsm(undefined)).toBeUndefined();
    expect(weeklyHoursToOsm({ monday: { open: null, close: null } })).toBeUndefined();
  });
});

const store = (id: string, extra: Partial<Store> = {}): Store => ({
  id, name: id, address: '100 Main St', city: 'San Diego', lat: 32.85, lng: -117.2, sources: [{ source: 'sample', externalId: id }],
  pickup: true, ownSitePickup: null, taxIncluded: true, delivery: [], ...extra,
});
const product = (storeId: string, price: number): Product => ({ id: `${storeId}:p`, storeId, source: 'sample', name: 'Blue Dream 3.5g', category: 'flower', grams: 3.5, price });

describe('beer places: open now', () => {
  const venue = (id: string, openingHours?: string, lat = 32.85): BeerVenue => ({ id, name: id, kind: 'bar', lat, lng: -117.2, openingHours, source: 'osm' });
  it('hides closed places and lists known-open places before unknown ones', () => {
    const venues = [venue('unknown-near', undefined, 32.851), venue('open-far', 'Mo-Su 11:00-02:00', 32.9), venue('closed', 'Mo-Su 08:00-12:00'), venue('closing', 'Mo-Su 11:00-16:30', 32.95)];
    const q = { lat: 32.85, lng: -117.2, sort: 'closest' as const };
    const all = rankVenues(q, venues, [], [], WED(16));
    expect(all[0].venue.id).toBe('unknown-near'); // without "open now", closest is closest
    const open = rankVenues({ ...q, openNow: true }, venues, [], [], WED(16));
    expect(open.map((r) => r.venue.id)).toEqual(['open-far', 'closing', 'unknown-near']);
    expect(open[1]).toMatchObject({ isOpen: true, closingSoon: true, hoursLabel: 'Closes 4:30 PM' });
  });
});

describe('weed stores: open now', () => {
  it('hides stores that are closed, keeps open and unknown-hours stores', () => {
    const stores = new Map([
      ['open', store('open', { hours: 'Mo-Su 08:00-22:00' })],
      ['closed', store('closed', { hours: 'Mo-Su 08:00-12:00' })],
      ['unknown', store('unknown')],
    ]);
    const products = [product('open', 30), product('closed', 20), product('unknown', 25)];
    const q = { mode: 'pickup' as const, now: WED(16) };
    expect(rankItems(products, stores, [], new Map(), DEFAULT_PROFILE, q)).toHaveLength(3);
    const shown = rankItems(products, stores, [], new Map(), DEFAULT_PROFILE, { ...q, openNow: true });
    expect(shown.map((i) => i.store.id).sort()).toEqual(['open', 'unknown']);
    expect(shown.find((i) => i.store.id === 'open')!.open).toMatchObject({ isOpen: true, label: 'Open until 10 PM' });
    expect(shown.find((i) => i.store.id === 'unknown')!.open).toEqual({ isOpen: null });
  });
  it('merging sources keeps the hours one of them knows', () => {
    const a = store('dutchie:1', { name: 'Wellgreens', sources: [{ source: 'dutchie', externalId: '1' }] });
    const b = store('weedmaps:wellgreens', { name: 'Wellgreens', sources: [{ source: 'weedmaps', externalId: 'wellgreens' }], hours: 'Mo-Su 06:00-21:55' });
    const merged = mergeResults([{ stores: [a], products: [], deals: [] }, { stores: [b], products: [], deals: [] }]);
    expect(merged.stores).toHaveLength(1);
    expect(merged.stores[0]).toMatchObject({ id: 'dutchie:1', hours: 'Mo-Su 06:00-21:55' });
  });
});
