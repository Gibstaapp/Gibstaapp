import { describe, expect, it } from 'vitest';
import { parseGrams, parseThcMg, mapCategory } from '../src/normalize.ts';

describe('normalize', () => {
  it('parses grams', () => {
    expect(parseGrams('Blue Dream 3.5g')).toBe(3.5);
    expect(parseGrams('Pre-roll .75g')).toBe(0.75);
    expect(parseGrams('1/8 oz')).toBe(3.5);
    expect(parseGrams('0.5g x 5')).toBe(2.5);
    expect(parseGrams('500mg cart')).toBe(0.5);
  });
  it('parses THC mg', () => {
    expect(parseThcMg('Gummies 100mgTHC')).toBe(100);
    expect(parseThcMg('10mg x 10')).toBe(100);
  });
  it('maps categories', () => {
    expect(mapCategory('Vaporizers', 'Live Resin Cart')).toBe('vape');
    expect(mapCategory('Pre-Rolls')).toBe('preroll');
  });
});

import { cleanStoreName, sameStore, streetKey } from '../src/normalize.ts';
describe('store merge', () => {
  const st = (name: string, address: string, lat: number, lng: number) => ({ id: name, name, address, city: 'San Diego', lat, lng, sources: [], pickup: true, ownSitePickup: null, taxIncluded: null, delivery: [] });
  it('cleans SEO names', () => {
    expect(cleanStoreName('Wellgreens - Kearny Mesa - Marijuana Weed Dispensary')).toBe('Wellgreens - Kearny Mesa');
    expect(cleanStoreName('BUZZ - Mission Valley')).toBe('BUZZ - Mission Valley');
  });
  it('matches the same street address even with different names/coords', () => {
    expect(streetKey('Wellgreens Kearny Mesa, 8039 Balboa Ave SUITE B')).toBe('8039 balboa');
    expect(sameStore(st('Wellgreens - Balboa', '8039 Balboa Ave # A', 32.8213, -117.15), st('Wellgreens - Kearny Mesa', 'Wellgreens Kearny Mesa, 8039 Balboa Ave SUITE B', 32.8249, -117.1552))).toBe(true);
  });
  it('matches same name within a mile, not different stores of a chain', () => {
    expect(sameStore(st('BUZZ - Lemon Grove', 'Lemon Grove', 32.7426, -117.0314), st('Buzz Cannabis- Lemon Grove', '8290 BROADWAY', 32.7463, -117.019))).toBe(true);
    expect(sameStore(st('Wellgreens - Lemon Grove', '6859 Federal Blvd', 32.7399, -117.0507), st('Wellgreens - University', '7180 University Ave', 32.7553, -117.0435))).toBe(false);
  });
});
