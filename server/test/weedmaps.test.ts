import { describe, expect, it } from 'vitest';
import { itemToProducts, parseDealText, taxIncludedFromText } from '../src/sources/weedmaps.ts';

const one = (title: string, body = '', extra = {}) => parseDealText({ title, body, ...extra });

describe('parseDealText', () => {
  it('percent off, storewide', () => {
    const [d] = one('30% OFF ENTIRE STORE + DAILY SPECIALS');
    expect(d).toMatchObject({ kind: 'percent', value: 30, audience: 'everyone', appliesTo: {} });
  });

  it('first-time customers', () => {
    const [d] = one('50% OFF FIRST PURCHASE', '50% off First Time Customers | Must show this ad at check-in to redeem');
    expect(d).toMatchObject({ kind: 'percent', value: 50, audience: 'first_time' });
    expect(d.conditions.limitPerCustomer).toBe(1);
    expect(d.finePrint).toContain('Must show this ad');
  });

  it('falls back to body when title has no value', () => {
    const [d] = one('MANKIND NEW CUSTOMERS SAVE 60% IN TOTAL VALUE!', 'California locals, this one\'s for you! Show your valid California ID and enjoy 50% OFF your qualifying purchase plus an extra 10% back in rewards.');
    expect(d).toMatchObject({ kind: 'percent', value: 50, audience: 'first_time' });
    expect(d.conditions.idRequired).toBe(true);
  });

  it('dollar off with min spend', () => {
    const [d] = one('New Patient Offer', 'Get $20 off when you spend $120 or above!');
    expect(d).toMatchObject({ kind: 'amount', value: 20, audience: 'first_time' });
    expect(d.conditions.minSpend).toBe(120);
  });

  it('bundle', () => {
    const [d] = one('2 for $50 Cookies eighths');
    expect(d).toMatchObject({ kind: 'bundle', bundleQty: 2, bundlePrice: 50 });
    expect(d.appliesTo).toMatchObject({ categories: ['flower'], minGrams: 3.5, maxGrams: 3.5 });
    const [e] = one('Any Four 8ths $50!!! Out The Door!!!');
    expect(e).toMatchObject({ kind: 'bundle', bundleQty: 4, bundlePrice: 50 });
  });

  it('bogo', () => {
    expect(one('BOGO 50% off carts')[0]).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50, appliesTo: { categories: ['vape'] } });
    expect(one('Buy one get one free edibles')[0]).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 100, appliesTo: { categories: ['edible'] } });
    expect(one('B2G1 Gummies')[0]).toMatchObject({ kind: 'bogo', bogoBuy: 2 });
  });

  it('days and categories', () => {
    const [d] = one('Wax Wednesday 25% off');
    expect(d).toMatchObject({ kind: 'percent', value: 25, days: [3], appliesTo: { categories: ['concentrate'] } });
    expect(one('Weekend 15% off')[0].days).toEqual([0, 6]);
  });

  it('brand after "off"', () => {
    const [d] = one('50% Off ALL GELATO products', 'Cannot combine or stack discounts.');
    expect(d.appliesTo.brands).toEqual(['GELATO']);
    expect(d.stackable).toBe(false);
  });

  it('audiences', () => {
    expect(one('Veterans 15% off')[0].audience).toBe('veteran');
    expect(one('Senior discount 10% off')[0].audience).toBe('senior');
    expect(one('Students get 10% off')[0]).toMatchObject({ audience: 'student', conditions: { idRequired: true } });
  });

  it('fixed price', () => {
    expect(one('In-store: $99 ounces')[0]).toMatchObject({ kind: 'fixed', value: 99, appliesTo: { categories: ['flower'], minGrams: 28 } });
  });

  it('splits multi-offer titles', () => {
    const ds = one('30% off CAM; B2G1 Edibles & Cake; 50% Off Gelato..');
    expect(ds.map((d) => d.kind)).toEqual(['percent', 'bogo', 'percent']);
    expect(ds[0].appliesTo.brands).toEqual(['CAM']);
  });

  it('real-world titles from SD listings', () => {
    const [a] = one('35% off Stiiizy Pods and All-In-Ones');
    expect(a.appliesTo).toEqual({ categories: ['vape'], brands: ['Stiiizy'] });
    const [b] = one('THIRSTY THURSDAYS | DAILY DEALS + 45% OFF FTP!');
    expect(b).toMatchObject({ kind: 'percent', value: 45, audience: 'first_time', appliesTo: {} });
    expect(b.days).toBeUndefined();
    expect(one('50% OFF ENTIRE STORE ALL DAY & EVERYDAY!')[0].appliesTo).toEqual({});
    expect(one('Everyday KLOVER 30: 30% OFF EVERYTHING, EVERY DAY', 'Half off Monday to Thursday on one brand')[0].days).toBeUndefined();
    expect(one('Thursday BOGO Deal', 'BOGO on house pre-packs. Thursday only.')).toEqual([]);
  });

  it('skips vague or valueless deals', () => {
    expect(one('Daily Deals Up to 50% Off', 'BOGO edibles')).toEqual([]);
    expect(one('Half Off, Monday to Thursday: One Brand, 50% OFF')).toEqual([]);
    expect(one('Thursday Deals at BUZZ', 'Every Thursday get 50% OFF select brands. Not valid with any other offer!')).toEqual([]);
    expect(one('30% OFF YOUR FAVORITE BRANDS!')).toEqual([]);
    expect(one('Best edible selection in town!!!', 'Come check out the biggest selection of edibles')).toEqual([]);
    expect(one('40% OFF SPECIALS (11/9-11/15)')).toEqual([]);
    expect(one('Up to 50% off')).toEqual([]);
  });
});

describe('taxIncludedFromText', () => {
  it('detects', () => {
    expect(taxIncludedFromText('All prices include tax!')).toBe(true);
    expect(taxIncludedFromText('Taxes included in all prices')).toBe(true);
    expect(taxIncludedFromText('Prices are plus tax')).toBe(false);
    expect(taxIncludedFromText('Welcome!')).toBeUndefined();
  });
});

describe('itemToProducts', () => {
  it('one product per variant with sale price', () => {
    const ps = itemToProducts({
      id: 1, name: 'Blue Dream', slug: 'blue-dream', category: { name: 'Hybrid' },
      edge_category: { name: 'Buds', ancestors: [{ name: 'Flower' }] },
      brand_endorsement: { brand_name: 'Pacific Stone' },
      metrics: { aggregates: { thc: 24, thc_unit: '%' } },
      prices: { grams_per_eighth: 3.5, ounce: [
        { id: 10, label: '1/8 oz', price: 20, on_sale: true, original_price: 25, discount_label: '-20%', weight: { value: 0.125, unit: 'oz' } },
        { id: 11, label: '1/4 oz', price: 40, on_sale: false, weight: { value: 0.25, unit: 'oz' } },
      ] },
    }, 'weedmaps:x', 'https://weedmaps.com/dispensaries/x');
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ category: 'flower', grams: 3.5, price: 25, salePrice: 20, saleLabel: '-20%', thcPct: 24, brand: 'Pacific Stone', strainType: 'hybrid' });
    expect(ps[1]).toMatchObject({ grams: 7, price: 40 });
    expect(ps[0].id).not.toBe(ps[1].id);
  });

  it('edible thc mg, and Kush Mints flower stays flower', () => {
    const [e] = itemToProducts({ id: 2, name: 'Island Punch | 10mg Gummies | 100mg Total', category: { name: 'Edible' }, edge_category: { name: 'Gummies', ancestors: [{ name: 'Edibles' }] }, metrics: { aggregates: { thc: 100, thc_unit: 'mg' } }, prices: { unit: [{ id: 1, label: 'each', price: 20 }] } }, 's', 'u');
    expect(e).toMatchObject({ category: 'edible', thcMg: 100 });
    const [f] = itemToProducts({ id: 3, name: 'Kush Mints 3.5g', category: { name: 'Indica' }, edge_category: { name: 'Buds', ancestors: [{ name: 'Flower' }] }, prices: { ounce: [{ id: 1, label: '1/8 oz', price: 30, weight: { value: 0.125, unit: 'oz' } }] } }, 's', 'u');
    expect(f).toMatchObject({ category: 'flower', grams: 3.5 });
  });
});
