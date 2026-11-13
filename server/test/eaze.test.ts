import { describe, expect, it } from 'vitest';
import { parseDealText } from '../src/sources/eaze.ts';

describe('eaze parseDealText', () => {
  it('reads percent + promo code from a deal group', () => {
    const d = parseDealText('Save the errand for another day. 30% Off. 🍂 — Use Code: 30OFF');
    expect(d).toMatchObject({ kind: 'percent', value: 30, audience: 'everyone', codes: ['30OFF'] });
    expect(d?.days).toBeUndefined();
  });

  it('first order amount with minimum', () => {
    const d = parseDealText('$10 off your first order of $50 or more. Code: WELCOME10');
    expect(d).toMatchObject({ kind: 'amount', value: 10, audience: 'first_time', codes: ['WELCOME10'] });
    expect(d?.conditions.minSpend).toBe(50);
    expect(d?.conditions.limitPerCustomer).toBe(1);
  });

  it('bundle, bogo, days, categories', () => {
    expect(parseDealText('2 for $40 eighths')).toMatchObject({ kind: 'bundle', bundleQty: 2, bundlePrice: 40, categories: ['flower'] });
    expect(parseDealText('BOGO carts')).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 100, categories: ['vape'] });
    expect(parseDealText('Buy 2 gummies, get 1 free')).toMatchObject({ kind: 'bogo', bogoBuy: 2, bogoGetPct: 100 });
    expect(parseDealText('Buy one get one 50% off')).toMatchObject({ kind: 'bogo', bogoBuy: 1, bogoGetPct: 50 });
    expect(parseDealText('Wax Wednesday: 25% off concentrates')).toMatchObject({ kind: 'percent', value: 25, days: [3], categories: ['concentrate'] });
  });

  it('skips unparseable / gift-with-purchase / "up to"', () => {
    expect(parseDealText('Buy 2 turn Pods, Get a Free PodPak — Add 2 turn Pods and 1 PodPak to your cart. Use code TURN at checkout to unlock the deal!')).toBeNull();
    expect(parseDealText('Gummies and Mints — Dosable, portable and discreet sweets.')).toBeNull();
    expect(parseDealText('Bulk Flower: 5g and Up')).toBeNull();
    expect(parseDealText('Up to 50% off select brands')).toBeNull();
    expect(parseDealText('USE CODE 30OFF')).toBeNull();
  });
});
