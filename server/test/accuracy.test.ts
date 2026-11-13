import { describe, expect, it } from 'vitest';
import type { Store } from '@gib/shared';
import { checkIn, earnedBadges, placeBadge, visitsToNext, type VisitLog } from '@gib/shared';
import { parseEuroPrices, parsePrices } from '../src/beer/extract.ts';
import { mergeResults, parseGrams } from '../src/normalize.ts';
import { repairPackWeight } from '../src/sanitize.ts';

// Real snippets from bar websites that used to produce wrong "beer prices".
describe('beer prices: things that are not a beer price', () => {
  const items = (text: string, hh = false) => parsePrices(text, hh).map((p) => `${p.item} $${p.price}`);
  it('"can" inside American / Mexican / Moroccan is not a can of beer', () => {
    expect(items('Cocktails American Pie $13.00 Apple Pie Whiskey, Pineapple Juice')).toEqual([]);
    expect(items('simple syrup Mexican Mullet $13.00 Smirnoff Tamarind Vodka')).toEqual([]);
    expect(items('Moroccan Green Mint $6.0 Re')).toEqual([]);
    expect(items('watermelon, lemon, cucumber $ 15.00 Beach Cruiser Cane run rum, coconut', true)).toEqual([]);
  });
  it('food, champagne, cocktails, add-ons and combos', () => {
    expect(items('Happy Hour 5:00 pm - 11:00 pm $8 All You Can Eat Spaghetti', true)).toEqual([]);
    expect(items('topped with bacon. Bottle of Champagne $15.00 Order Parties')).toEqual([]);
    expect(items('$6 vodka highballs, $10 draft cocktails and $12 signature cocktails.', true)).toEqual([]);
    expect(items('Make it spicy +$1 Absinthe spritz +$2 Try a Draft Cocktail Flight', true)).toEqual([]);
    expect(items('Taco Tuesday • 2 Tacos + Mexican Lager $14 10:00 AM')).toEqual([]);
  });
  it('food combos on dollar menus (real PDF snippet)', () => {
    expect(items('Wednesday: ½ off wings Thursday: Nachos & a Beer $14 PLEASE PLACE YOUR ORDER', true)).toEqual([]);
    expect(items('Pizza and a Pint $17', true)).toEqual([]);
    // A heading with '+' isn't an add-on. (Coors Light is skipped as too close to 'SELTZER': a missed price, never a wrong one.)
    expect(items('BEER + SELTZER + NON-ALCOHOLIC Coors Light $8 Corona $10 Peroni $10')).toEqual(['Corona $10']);
  });
  it('a price that belongs to the next thing, or only applies until a time', () => {
    expect(items('$24 Pitchers on select drafts $5 Mimosas')).toEqual([]);
    expect(items('ALL beers are just $6 until 6pm & VINYL SLICES')).toEqual([]);
  });
  it('wine in a can, bare "Can", and the name of the special', () => {
    expect(items('Wine Archer Roose Pinot Noir 8.4oz can $12.00 Archer Roose Sauvignon Blanc 8.4')).toEqual([]);
    expect(items('Woodbridge Cabernet 6.3oz can $10.00 Woodbridge, Chardonnay 6.3oz Can')).toEqual([]);
    expect(items('all $9.00 PBR 24oz Tall Can $9.00 Seltzers')).toEqual([]);
    expect(items('DAILY Drink & Food SPECIALS Bottled Beer Mondays $5 Select bottled beers Taco Tuesdays', true)).toEqual(['Select bottled beers $5']);
  });
  it('still finds the real ones', () => {
    expect(items('Bud Light $6.00 Budweiser $6.00 Coors Light $6.00 Stella $7.00')).toEqual(['Bud Light $6', 'Coors Light $6', 'Stella $7']);
    expect(items('HAPPY HOUR · $5 Wells · $5 Select Drafts · $2 Off Cocktails', true)).toEqual(['Select Drafts $5']);
    expect(items('$4 House Wines $3.50 Domestic Bottles We also spin the wheel', true)).toEqual(['Domestic Bottles $3.5']);
  });
});

describe('pre-roll pack weights', () => {
  it('"14pk 7g" is 7g in total, "5pk 0.35g" is five 0.35g joints', () => {
    expect(parseGrams('Modified Mints Sungrown Pre-Roll 14pk 7g')).toBe(7);
    expect(parseGrams('DIME- Infused Preroll 10pk Wedding Cake Hybrid 7g')).toBe(7);
    expect(parseGrams('City Roots - Blue Dream 7pk Live Resin Infused Prerolls 7g')).toBe(7);
    expect(parseGrams('Mini Dogwalkers 5pk 0.35g')).toBe(1.75);
    expect(parseGrams('Shorties 10pk 0.35g')).toBe(3.5);
    expect(parseGrams('0.5g x 5')).toBe(2.5);
  });
});

describe('old data with wrong pack weights is repaired', () => {
  const p = (name: string, grams: number) => ({ id: name, storeId: 's', source: 'dutchie' as const, name, category: 'preroll' as const, grams, price: 20 });
  it('fixes count x weight, leaves everything else alone', () => {
    expect(repairPackWeight(p('West Coast Cure - GMO (Indica) 6pk Minis Preroll 2.1g', 12.6)).grams).toBe(2.1);
    expect(repairPackWeight(p('Modified Mints Sungrown Pre-Roll 14pk 7g', 98)).grams).toBe(7);
    expect(repairPackWeight(p('Mini Dogwalkers 5pk 0.35g', 1.75)).grams).toBe(1.75);
    expect(repairPackWeight(p('Modified Mints Sungrown Pre-Roll 14pk 7g', 7)).grams).toBe(7);
    expect(repairPackWeight(p('Blue Dream 1g', 1)).grams).toBe(1);
  });
});

describe('same shop under two ids', () => {
  const store = (id: string, source: 'dutchie' | 'weedmaps', name: string, address: string): Store => ({
    id, name, address, city: 'San Diego', lat: 32.8213, lng: -117.15, sources: [{ source, externalId: id }], pickup: true, ownSitePickup: null, taxIncluded: null, delivery: [],
  });
  it('is folded into one store and products follow', () => {
    const a = store('dutchie:1', 'dutchie', 'Wellgreens - Balboa', '8039 Balboa Ave # A');
    const b = store('weedmaps:wg', 'weedmaps', 'Wellgreens - Kearny Mesa', 'Wellgreens Kearny Mesa Cannabis Dispensary, 8039 Balboa Ave SUITE B,');
    const p = { id: 'p1', storeId: 'weedmaps:wg', source: 'weedmaps' as const, name: 'Blue Dream 3.5g', category: 'flower' as const, grams: 3.5, price: 20 };
    const m = mergeResults([{ stores: [b, a], products: [p], deals: [] }]);
    expect(m.stores.map((s) => s.id)).toEqual(['dutchie:1']);
    expect(m.products[0].storeId).toBe('dutchie:1');
    // merging the same pair again doesn't list a source twice
    const again = mergeResults([{ stores: [...m.stores, b], products: [], deals: [] }]);
    expect(again.stores[0].sources).toHaveLength(2);
  });
});

describe('badges', () => {
  const place = { id: 'osm:1', name: 'The Shack', side: 'beer' as const };
  const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const visit = (n: number) => days(n).reduce<VisitLog>((log, d) => checkIn(log, place, d).log, {});
  it('one check-in per place per day', () => {
    const first = checkIn({}, place, '2026-11-13');
    expect(first).toMatchObject({ added: true, visits: 1, newBadges: [] });
    expect(checkIn(first.log, place, '2026-11-13')).toMatchObject({ added: false, visits: 1 });
  });
  it('fifth visit earns the first badge, tenth the next', () => {
    expect(placeBadge(visit(4)[place.id])).toBeNull();
    expect(visitsToNext('beer', 4)).toMatchObject({ need: 1 });
    const fifth = checkIn(visit(4), place, '2026-11-20');
    expect(fifth.newBadges.map((b) => b.title)).toEqual(['The Regular']);
    expect(placeBadge(visit(9)[place.id])?.title).toBe('The Regular');
    expect(placeBadge(visit(10)[place.id])?.title).toBe('Barfly');
    expect(checkIn(visit(5), place, '2026-11-20').newBadges).toEqual([]); // 6th visit: nothing new
  });
  it('five different places earns the explorer badge', () => {
    let log: VisitLog = {};
    for (let i = 0; i < 5; i++) log = checkIn(log, { id: `s${i}`, name: `Shop ${i}`, side: 'weed' }, '2026-11-13').log;
    expect(earnedBadges(log).map((b) => b.title)).toEqual(['Trailblazer']);
  });
});

describe('euro prices (Athens bar websites)', () => {
  const eu = (text: string, hh = false) => parseEuroPrices(text, hh).map((p) => `${p.item} | ${p.size ?? '-'} | €${p.price}`);
  it('menu lines in English and Greek, with sizes and decimal commas', () => {
    expect(eu('Draft\nMythos 500ml\n\n5% vol – \n\n4.00€\nFix 400ml\n\n5% vol – \n\n3.50€')).toEqual(['Mythos | 500ml | €4', 'Fix | 400ml | €3.5']);
    expect(eu('Μπύρα βαρέλι 0,5L 5,50 €')).toEqual(['Μπύρα βαρέλι | 500ml | €5.5']);
    expect(eu('Amstel 33cl €4')).toEqual(['Amstel | 330ml | €4']);
  });
  it('happy-hour style "€4 draft beers"', () => {
    expect(eu('HAPPY HOUR 18:00-21:00 €4 draft beers and €6 cocktails', true)).toEqual(['Draft beers | - | €4']);
    expect(eu('Happy hour: 5€ μπύρα βαρέλι, 7€ ποτό', true)).toEqual(['Μπύρα βαρέλι | - | €5']);
  });
  it('skips wine, cocktails, food combos, and two-price lines where the size is unclear', () => {
    expect(eu('Κρασί ποτήρι 6 € Κοκτέιλ 9€ Gin tonic 9€')).toEqual([]);
    expect(eu('Burger & beer 14€')).toEqual([]);
    expect(eu('Draft Beers 330ml / 500ml Nymfi (5 Hops Lager - Greece) 4€ / 5€')).toEqual([]);
    expect(eu('Ginger beer 4€')).toEqual([]);
    // From real Athens PDFs: a wine list ("Κτήμα Avantis Νύμφη", an Assyrtiko named Corona) and a lone style word.
    expect(eu('Λευκά κρασιά  Κτήμα Avantis Νύμφη  5,50 €  Ασύρτικο Corona  6,50 €')).toEqual([]);
    expect(eu('Complexity in aromas and flavors. Ale  330ml  €7.50')).toEqual([]);
    expect(eu('House lager  500ml  €4.00')).toEqual(['House lager | 500ml | €4']);
    // From Barrett's real menu: a whiskey called "IPA Edition", under the whiskey heading.
    expect(eu('whiskey Jameson Irish Whiskey 8€ Jameson Black Barrel 10€ Jameson IPA Edition 10€')).toEqual([]);
    expect(eu('(3.42)\n\n440ml Can\n8.70 EUR')).toEqual([]);
  });
});
