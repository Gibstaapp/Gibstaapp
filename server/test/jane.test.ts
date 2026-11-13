import { describe, expect, it } from 'vitest';
import { audienceFromText, dealFromSpecial, parseDealText, productsFromHit } from '../src/sources/jane.ts';

const URL = 'https://www.iheartjane.com/stores/1/x';

describe('jane parseDealText', () => {
  it('percent / amount / bundle / bogo', () => {
    expect(parseDealText('EVERYDAY - 30% OFF SELECT BRANDS!')).toEqual({ kind: 'percent', value: 30 });
    expect(parseDealText('$5 off Kiva')).toEqual({ kind: 'amount', value: 5 });
    expect(parseDealText('2 for $50 eighths')).toEqual({ kind: 'bundle', bundleQty: 2, bundlePrice: 50 });
    expect(parseDealText('Buy 1 Get 1 Half Off')).toEqual({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50 });
    expect(parseDealText('BOGO')).toEqual({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 100 });
    expect(parseDealText('You will receive $1 item at pick up')).toBeNull();
    expect(parseDealText('20% back on Wyld')).toBeNull();
  });
  it('audience', () => {
    expect(audienceFromText('20% off first time customers')).toBe('first_time');
    expect(audienceFromText('Veterans 15% off')).toBe('veteran');
    expect(audienceFromText('50% OFF JEETER VETERANS DAY DEAL')).toBe('everyone');
    expect(audienceFromText('Seniors - 10% OFF')).toBe('senior');
    expect(audienceFromText('Student discount')).toBe('student');
  });
});

describe('jane productsFromHit', () => {
  it('splits weights and reads sale prices', () => {
    const ps = productsFromHit({
      product_id: 9, name: 'GG4', brand: '710 Labs', kind: 'flower', root_subtype: 'Flower', category: 'hybrid', percent_thc: 23.4,
      price_eighth_ounce: 52.99, discounted_price_eighth_ounce: 37.09, price_ounce: 300, special_amount: '30% OFF', url_slug: 'gg4',
    }, 'jane:1', URL);
    expect(ps.map((p) => [p.id, p.grams, p.price, p.salePrice])).toEqual([
      ['jane:1:9:eighth_ounce', 3.5, 52.99, 37.09],
      ['jane:1:9:ounce', 28, 300, undefined],
    ]);
    expect(ps[0]).toMatchObject({ category: 'flower', strainType: 'hybrid', thcPct: 23.4, brand: '710 Labs' });
  });
  it('leading-decimal grams and edible mg', () => {
    const [pr] = productsFromHit({ product_id: 1, name: 'Graype [.75g]', kind: 'pre-roll', root_subtype: 'Pre Rolls', price_each: 9.99 }, 'jane:1', URL);
    expect(pr.grams).toBe(0.75);
    const [ed] = productsFromHit({ product_id: 2, name: 'Sleepy [20pk] (100mgTHC/50mgCBN)', kind: 'edible', root_subtype: 'Candies', amount: '20pk', price_each: 12 }, 'jane:1', URL);
    expect(ed).toMatchObject({ category: 'edible', thcMg: 100, unitCount: 20 });
    const [ti] = productsFromHit({ product_id: 3, name: 'Restore (500mg CBD/16mg THC)', kind: 'tincture', price_each: 40 }, 'jane:1', URL);
    expect(ti.thcMg).toBe(16);
  });
});

describe('jane dealFromSpecial', () => {
  const hits = [
    { product_id: 1, name: 'A', brand: 'Jeeter', product_brand_id: 20325, kind: 'pre-roll', price_each: 10 },
    { product_id: 2, name: 'B', brand: 'Other', product_brand_id: 5, kind: 'edible', root_subtype: 'Drinks', price_each: 5 },
    { product_id: 3, name: 'C', brand: 'Other', product_brand_id: 5, kind: 'flower', price_eighth_ounce: 30, price_quarter_ounce: 55 },
  ];
  const products = hits.flatMap((h) => productsFromHit(h, 'jane:1', URL));
  const ctx = {
    storeKey: 'jane:1', products,
    byJaneId: new Map(), janeIdOf: new Map(products.map((p) => [p.id, p.id.split(':')[2]])), hitOf: new Map(hits.map((h) => [String(h.product_id), h])),
  };
  const base = {
    id: 7, enabled: true, enabled_sunday: true, enabled_monday: true, enabled_tuesday: true, enabled_wednesday: true,
    enabled_thursday: true, enabled_friday: true, enabled_saturday: true, reservation_modes: { kiosk: true, pickup: true, delivery: true },
  };

  it('brand product special on Thursdays, pickup only', () => {
    const { deal } = dealFromSpecial({
      ...base, title: 'JEETER [SPECIAL: THURS]', special_type: 'product', discount_type: 'percent', discount_percent: 52,
      enabled_sunday: false, enabled_monday: false, enabled_tuesday: false, enabled_wednesday: false, enabled_friday: false, enabled_saturday: false,
      reservation_modes: { kiosk: true, pickup: true, delivery: false },
      rules: { version: 2, includes: [{ brands: ['Jeeter'], brand_ids: [20325] }], rule_sets: ['any', { includes: { brand_ids: [20325] } }] },
    }, ctx);
    expect(deal).toMatchObject({ kind: 'percent', value: 52, days: [4], appliesTo: { productIds: ['jane:1:1:each'] }, conditions: { pickupOnly: true } });
  });
  it('kind + subtype and weight targeting', () => {
    const drinks = dealFromSpecial({ ...base, title: 'Thirsty Thursdays', special_type: 'product', discount_type: 'percent', discount_percent: 10,
      rules: { version: 2, includes: [{ kinds: [{ kind: 'edible', root_subtype: 'Drinks' }] }] } }, ctx).deal;
    expect(drinks?.appliesTo.productIds).toEqual(['jane:1:2:each']);
    const quarter = dealFromSpecial({ ...base, title: 'Q', special_type: 'product', discount_type: 'percent', discount_percent: 50,
      rules: { version: 2, includes: [{ product_ids: [3], weights: ['quarter_ounce'] }] } }, ctx).deal;
    expect(quarter?.appliesTo.productIds).toEqual(['jane:1:3:quarter_ounce']);
  });
  it('qualified group, bundle, cart total', () => {
    expect(dealFromSpecial({ ...base, title: 'Seniors - 10% OFF', special_type: 'qualified_group', discount_type: 'percent', discount_percent: 10,
      conditions: { qualified_group: { type: 'senior', required_age: 65 } }, rules: { version: 2, rule_sets: ['any', { all_products: true }] } }, ctx).deal)
      .toMatchObject({ audience: 'senior', kind: 'percent', value: 10, appliesTo: {} });
    const side = { brands: ['Other'], brand_ids: [5], kinds: [{ kind: 'edible' }] };
    expect(dealFromSpecial({ ...base, title: 'BOGO half', special_type: 'bundle', discount_type: 'percent', discount_percent: 50,
      conditions: { bundle: { independent: { ...side, threshold_number_of_items_in_cart: 1 }, dependent: { ...side, max_number_of_discounted_products: 1 } } } }, ctx).deal)
      .toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50, appliesTo: { productIds: ['jane:1:2:each'] } });
    expect(dealFromSpecial({ ...base, title: 'APP10', special_type: 'cart_total', discount_type: 'dollar_amount', discount_dollar_amount: 10,
      conditions: { cart_total: { threshold: 0 } } }, ctx).skip).toBeTruthy();
    expect(dealFromSpecial({ ...base, title: 'X', special_type: 'cart_total', discount_type: 'percent', discount_percent: 40, promo_code: 'CAKE40',
      conditions: { cart_total: { threshold: 0 } } }, ctx).deal).toMatchObject({ kind: 'percent', value: 40, appliesTo: {} });
  });
});
