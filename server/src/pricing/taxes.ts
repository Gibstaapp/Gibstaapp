import type { TaxBreakdown } from '@gib/shared';

/**
 * California cannabis retail taxes, San Diego County.
 *
 * How CA stacks them (CDTFA, cdtfa.ca.gov/industry/cannabis/retailers.htm):
 *   local  = localRate * price                    (city cannabis business tax, when passed to the customer)
 *   base   = price + local + deliveryFee
 *   excise = 15% * base                            (15% from 2025-10-01 through 2029-06-30, per AB 564)
 *   sales  = salesRate * (base + excise)           (excise is part of gross receipts for sales tax)
 *
 * Rates below were checked Nov 2026 against news coverage + CDTFA. Local rates change often:
 * edit this table when a city changes its rate. `verified: false` = best guess, confirm before trusting.
 */
export const CA_EXCISE_RATE = 0.15;

export interface CityTax {
  salesRate: number;
  localCannabisRate: number;
  verified: boolean;
  note?: string;
}

export const CITY_TAXES: Record<string, CityTax> = {
  'san diego':      { salesRate: 0.0775, localCannabisRate: 0.10, verified: true, note: 'City raised retail cannabis tax 8% -> 10% on 2025-05-01' },
  'chula vista':    { salesRate: 0.0875, localCannabisRate: 0.07, verified: true },
  'vista':          { salesRate: 0.0875, localCannabisRate: 0.07, verified: true },
  'encinitas':      { salesRate: 0.0825, localCannabisRate: 0.07, verified: false },
  'oceanside':      { salesRate: 0.0825, localCannabisRate: 0.05, verified: true },
  'lemon grove':    { salesRate: 0.0875, localCannabisRate: 0.05, verified: true },
  'la mesa':        { salesRate: 0.0875, localCannabisRate: 0.05, verified: false, note: 'Council moved to raise 4% -> 5% (Jul 2026); confirm adoption' },
  'national city':  { salesRate: 0.0875, localCannabisRate: 0.05, verified: false },
  'el cajon':       { salesRate: 0.0825, localCannabisRate: 0.05, verified: false },
  'imperial beach': { salesRate: 0.0875, localCannabisRate: 0.05, verified: false },
};

// Unincorporated county / unknown city fallback.
export const DEFAULT_CITY_TAX: CityTax = { salesRate: 0.0775, localCannabisRate: 0.05, verified: false };

export function cityTax(city: string): CityTax {
  return CITY_TAXES[city.trim().toLowerCase()] ?? DEFAULT_CITY_TAX;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Taxes on a single purchase.
 * @param price        price after discounts
 * @param deliveryFee  delivery fee for this order (part of the taxable base in CA)
 * @param taxIncluded  true when the listed price already includes taxes
 */
export function computeTax(price: number, city: string, deliveryFee = 0, taxIncluded: boolean | null = null): TaxBreakdown {
  if (taxIncluded) {
    return { local: 0, excise: 0, sales: 0, total: 0, estimated: false, included: true };
  }
  const t = cityTax(city);
  const local = t.localCannabisRate * price;
  const base = price + local + deliveryFee;
  const excise = CA_EXCISE_RATE * base;
  const sales = t.salesRate * (base + excise);
  return {
    local: round2(local),
    excise: round2(excise),
    sales: round2(sales),
    total: round2(local + excise + sales),
    estimated: true,
    included: false,
  };
}
