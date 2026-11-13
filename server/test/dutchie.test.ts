import { describe, expect, it } from 'vitest';
import { parseAudience, parseDealText } from '../src/sources/dutchie.ts';

describe('dutchie parseDealText', () => {
  it('percent / amount / bundle', () => {
    expect(parseDealText('Alien Labs 50% OFF')).toMatchObject({ kind: 'percent', value: 50, audience: 'everyone' });
    expect(parseDealText('$5 off Kiva')).toMatchObject({ kind: 'amount', value: 5 });
    expect(parseDealText('Gelato 2 for $5 Pre-rolls')).toMatchObject({ kind: 'bundle', bundleQty: 2, bundlePrice: 5 });
    expect(parseDealText('CITY ROOTS: 4/$109+TAX PREMIUM FLOWER 7G')).toMatchObject({ kind: 'bundle', bundleQty: 4, bundlePrice: 109 });
    expect(parseDealText('CAM Select Pre-Rolls: Two For $12')).toMatchObject({ kind: 'bundle', bundleQty: 2, bundlePrice: 12 });
  });

  it('bogo variants', () => {
    expect(parseDealText('Royal Blunts | 1G BOGO')).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 100 });
    expect(parseDealText('BOGO 50% off carts')).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50 });
    expect(parseDealText('Buy 2 Get 1 Free edibles')).toMatchObject({ kind: 'bogo', bogoBuy: 2, bogoGetPct: 100 });
    expect(parseDealText('B2G1 gummies')).toMatchObject({ kind: 'bogo', bogoBuy: 2, bogoGetPct: 100 });
    expect(parseDealText('Kanha: B2GO For $0.01')).toMatchObject({ kind: 'bogo', bogoBuy: 2, bogoGetPct: 100 });
  });

  it('refuses to guess', () => {
    expect(parseDealText('VIOR Vapes: BOGO for $1')).toBeNull();
    expect(parseDealText('WYLD: Buy Any 2, Get A 3rd For $1')).toBeNull();
    expect(parseDealText('Smokiez Gummies: Buy 2, Get 1 For $1')).toBeNull();
    expect(parseDealText('LEGACY GENETIX: AIOS 2/$25 OTD')).toBeNull();
    expect(parseDealText('Quiet King: Buy A 1/2oz, Get A Pre-Roll 5-Pack For $1')).toBeNull();
    expect(parseDealText('New arrivals!')).toBeNull();
  });

  it('audience and conditions', () => {
    expect(parseDealText('First time customers 30% off')).toMatchObject({ kind: 'percent', value: 30, audience: 'first_time' });
    expect(parseDealText('Veterans 15% off with valid ID')).toMatchObject({ audience: 'veteran', conditions: { idRequired: true } });
    expect(parseDealText('Spend $50 get 10% off')?.conditions.minSpend).toBe(50);
    expect(parseAudience('Seniors 65+ save 10%')).toBe('senior');
    expect(parseAudience('UP!: 2/$60+TAX POD 1G')).toBe('everyone');
    expect(parseAudience('Student discount 10%')).toBe('student');
  });
});
