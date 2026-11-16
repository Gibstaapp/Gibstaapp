import { describe, expect, it } from 'vitest';
import type { Store } from '@gib/shared';
import { checkIn, earnedBadges, placeBadge, visitsToNext, type VisitLog } from '@gib/shared';
import { extractHappyHour, parseEuroPrices, parsePrices } from '../src/beer/extract.ts';
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
  it('keeps brand names and drops lone generic items (real NYC menu snippets)', () => {
    expect(items('$ 11 Fiddlehead IPA $ 11')).toEqual(['Fiddlehead IPA $11']);
    expect(items('Draft Beer Threes Vliet Pilsner $ 8')).toEqual(['Threes Vliet Pilsner $8']);
    expect(items('and enjoy our IPA $8 tonight')).toEqual([]);
    expect(items('/ $ 14 / $ 56 BEER $ 8.32 / $ 8 Corona, Mexico')).toEqual([]);
    expect(items('Bottles Pacifico $ 8')).toEqual(['Pacifico $8']);
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

// Real New York snippets that gave wrong prices or names (checked against the bars' own pages, Nov 2026).
describe('New York menus', () => {
  const items = (t: string, hh = false) => parsePrices(t, hh).map((p) => `${p.item}|${p.price}`);
  it('"$5 Boot Brew – any draft $7 & under" is $5, not a $7 draft', () => {
    expect(items('HAPPY HOUR $ 5 BOOT BREW $ 5 any draft $7 & under $ 9 add a flavor +1 BOOTRITA house margarita', true)).not.toContain('Draft|7');
  });
  it('combos with a shot or food are not beer prices', () => {
    expect(items('All day everyday!!! $7 can of Miller and a shot of whiskey $8 can of Modelo and a shot of tequila Happy Hour!', true)).toEqual([]);
    expect(items('Wing Tuesdays $1 wings 5–8 PM, minimum of 6 per order. Plus $10 beer, shot & 6 wings.', true)).toEqual([]);
    expect(items('onions, pickles. Served with curly fries & a pint of house lager $15 Draft Beer $2 OFF', true)).toEqual([]);
  });
  it('a price before the name belongs to the item before it when the menu puts prices after names', () => {
    const r = items('Blue Moon $10.00 Mich Ultra $7.00 Bronx Hazy $10.00 Coors Light $7.00 Colorado Downeast Unfiltered Cider $9.00', true);
    expect(r).toContain('Coors Light|7');
    expect(r).not.toContain('Coors Light|10');
    expect(items('$ 10 Negroni $ 10 $ 10 Well Liquor $ 10 DRAFT $ 7 Founders Lager $ 7', true)).not.toContain('DRAFT|10');
  });
  it('price-first happy hour lists still work', () => {
    expect(items('HAPPY HOUR MONDAY THROUGH FRIDAY UNTIL 7PM $6 DRAFT BEER $6 WELL DRINKS $6 WINES', true)).toContain('DRAFT BEER|6');
    expect(items('$4 pbr tall boy $4 miller high life $8 Wine', true)).toContain('Miller high life|4');
  });
  it('names: no "TO ANY", "ABV" or "NY" in front; three brand words kept', () => {
    expect(items('CANS *** $3 - SHOT ADD ON TO ANY CAN $5 - BUD - NARRAGANSETT')).toEqual([]);
    expect(items('Stella Artois $8.00 Lager, 16oz, Leuven, BELG 4.8% ABV Michelob Ultra $7.00 Goose Island IPA $9.00')).toContain('Michelob Ultra|7');
    expect(items('$8.00 Coney Island Pilsner $9.00 Coney Island, NY Coors Light $8.00 Colorado')).toContain('Coors Light|8');
    expect(items('Coney Island Mermaid Pilsner $ 10')).toEqual(['Coney Island Mermaid Pilsner|10']);
  });
  it('non-alcoholic beer is skipped', () => {
    expect(items('Athletic Free Wave Hazy IPA $ 8 Athletic Run Wild IPA $ 8')).toEqual([]);
  });
  it('real ones stay', () => {
    expect(items('oast IPA $9.00 Cans/Bottles Genesee* $3.00 Miller High Life $5.00 Budweiser $6.00 Bud Light Lime $4.00')).toContain('Miller High Life|5');
    expect(items('Peroni $ 8 Coors Light $ 7 Miller Lite $ 7')).toEqual(['Coors Light|7', 'Miller Lite|7']);
  });
});

describe('New York happy-hour times', () => {
  const win = (t: string) => extractHappyHour(t).windows.map((w) => `${w.start}-${w.end}`);
  it('opening hours after a "Happy Hour" link are not the happy hour', () => {
    expect(win('Cocktails Beer & Wine Happy Hour Events Come Visit Hours of Operation Monday : 3:00 pm – 12:00 am Tuesday')).toEqual([]);
    expect(win('All Day Happy Hour Monday! Hours Mon–Thu: 3PM–12AM | Fri: 3PM–3AM')).toEqual([]);
    expect(win('agave amari other spirits what we’re drinking happy hour dinner daily from 6:00 - 11:00 | v = vegan')).toEqual([]);
  });
  it('real happy hours stay, including late-night ones', () => {
    expect(win('UES Happy Hour Tue–Fri 4:20–6:20PM · $8 Draft Beers')).toEqual(['16:20-18:20']);
    expect(win('during happy hour (Sunday and Monday: 4 p.m. -4 a.m., the rest of the week')).toEqual(['16:00-04:00']);
    expect(win('HAPPY HOUR: Monday-Friday 2-6 TUESDAY: 8pm Bingo')).toEqual(['14:00-18:00']);
  });
});

describe('happy-hour lists: price-first vs name-first', () => {
  const items = (t: string) => parsePrices(t, true).map((p) => `${p.item}|${p.price}`);
  it('price-first: each price goes with the words after it', () => {
    expect(items('HAPPY HOUR MONDAY - FRIDAY [4pm - 8pm] $5 Bottled Beers $6 Drafts $8 Pinot Grigio, Pinot Noir')).toEqual(expect.arrayContaining(['Bottled Beers|5', 'Drafts|6']));
    expect(items('HAPPY HOUR MONDAY - FRIDAY [4pm - 8pm] $5 Bottled Beers $6 Drafts $8 Pinot Grigio')).not.toContain('Bottled Beers|6');
    expect(items('HOUR TUESDAY TO FRIDAY | 3PM-6PM AVAILABLE AT THE BAR ONLY $6 BOTTLED BEER $7 DRAFT PINTS $8 WINES $10 M')).toEqual(expect.arrayContaining(['BOTTLED BEER|6', 'DRAFT PINTS|7']));
    expect(items('Happy Hour (excluding holidays) Monday - Friday 4pm - 8pm $5 Beers $6 Guinness and Stella Drafts $8 Wine')).toContain('Beers|5');
  });
  it('name-first: the price after the name wins', () => {
    const r = items('HAPPY HOUR Monday to Friday 4pm – 7pm Wines $8 Draught Beers $7 Bottles/Cans $6 Cocktails $10');
    expect(r).toContain('Draught Beers|7');
    expect(r).not.toContain('Draught Beers|8');
    expect(items('Happy Hour Monday through Friday, 4–7pm. Apps $10 Draft Beer $5 Featured Cocktails $10')).toEqual(['Draft Beer|5']);
  });
});

describe('name-first happy hours never take the price before a name', () => {
  it('"Coors Light Draft $5 Harpoon Draft, Stella Draft / Kona Draft $7": Harpoon is $7, not $5', () => {
    const r = parsePrices('HAPPY HOUR Miller Lite / Coors Light Draft $5 Harpoon Draft, Stella Draft / Kona Draft $7 Rotating Seasonal Draft $8', true).map((p) => `${p.item}|${p.price}`);
    expect(r).toContain('Coors Light Draft|5');
    expect(r).not.toContain('Harpoon Draft|5');
  });
  it('"Happy hour specials $5 drafts" is still price-first', () => {
    expect(parsePrices('Happy hour specials $5 drafts $6 wells', true).map((p) => `${p.item}|${p.price}`)).toEqual(['Drafts|5']);
  });
});

describe('double-printed prices, price-first menus, cocktails', () => {
  const items = (t: string, hh = false) => parsePrices(t, hh).map((p) => `${p.item}|${p.price}`);
  it('"$ 10 Well Liquor $ 10 DRAFT $ 7 Founders Lager $ 7": DRAFT is a heading, not $10', () => {
    const r = items('Happy Hour Monday - Friday 2pm - 6pm $ 14 $ 10 Negroni $ 10 $ 10 Manhattan $ 10 $ 10 Well Liquor $ 10 DRAFT $ 7 Founders Lager $ 7 $ 8 Founders IPA $ 8', true);
    expect(r).not.toContain('DRAFT|10');
    expect(r).toEqual(expect.arrayContaining(['Founders Lager|7', 'Founders IPA|8']));
  });
  it('a price-first list read as a menu does not shift prices', () => {
    expect(items('HAPPY HOUR MONDAY - FRIDAY [4pm - 8pm] $5 Bottled Beers $6 Drafts $8 Pinot Grigio')).not.toContain('Bottled Beers|6');
  });
  it('a beer cocktail is not a beer price', () => {
    expect(items('HAPPY HOUR $ 7 SPAGHETT miller high life, aperol, lemon $ 7 $ 8 ROSE $ 8', true)).toEqual([]);
  });
  it('"ASK BARTENDER" is not part of a name', () => {
    expect(items('HOT DRINKS - ASK BARTENDER DRAFTS $8 - LAGER - PILSNER')).not.toContain('ASK BARTENDER DRAFTS|8');
  });
});

describe('live New York leftovers (Nov 16)', () => {
  const items = (t: string, hh = false) => parsePrices(t, hh).map((p) => `${p.item}|${p.price}`);
  it("Triona's: a block that starts price-first still gives Harpoon $7, not $5", () => {
    const t = 'Happy Hours & Specials LATE NIGHT $10 Espresso Martini $7 Draft Beer $8 03:00 PM - 07:00 PM HAPPY HOUR Miller Lite / Coors Light Draft $5 Harpoon Draft, Stella Draft / Kona Draft $7 Rotating Seasonal Draft $8';
    const r = items(t, true);
    expect(r).not.toContain('Harpoon Draft|5');
    expect(r).toContain('Coors Light Draft|5');
  });
  it('non-alcoholic named before the brand, or marked 0.0% after the price', () => {
    expect(items('eaux, France • 2014 Non-Alcoholic Bitburger Drive Pilsner $9 0.0% ABV Athletic Brewing Run Wild IPA $9 Less than 0.05% ABV')).toEqual([]);
  });
});
