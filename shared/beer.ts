// ---- Beer side of the app (ported from the BeerFinder prototype) ----

/** 'restaurant' = a restaurant or grill: shown only when its own website lists beer prices or a happy hour. */
export type BeerVenueKind = 'bar' | 'brewery' | 'store' | 'restaurant';

export interface BeerVenue {
  id: string;               // "osm:node/123" or "custom:<slug>"
  name: string;
  kind: BeerVenueKind;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  website?: string;
  phone?: string;
  openingHours?: string;    // OpenStreetMap opening_hours syntax, e.g. "Mo-Fr 11:00-02:00; Sa,Su 10:00-02:00"
  source: 'osm' | 'seed' | 'user';
}

export type BeerPriceKind = 'regular' | 'happy_hour' | 'special';
export type BeerPriceSource = 'website' | 'seed' | 'user' | 'team';

/** One known price for a beer at a venue. */
export interface BeerPrice {
  id: string;
  venueId: string;
  item: string;             // "Draft pints", "Modelo 24oz can", "Pliny the Elder"
  price: number;            // in `currency`
  currency?: 'USD' | 'EUR'; // missing = USD (San Diego data)
  size?: string;            // "pint", "16oz", "6-pack"
  kind: BeerPriceKind;
  /** When this price applies. Missing = any time the venue is open. */
  days?: number[];          // 0 = Sunday … 6 = Saturday
  start?: string;           // "15:00"
  end?: string;             // "18:00" (may be < start for past-midnight)
  source: BeerPriceSource;
  sourceUrl?: string;
  snippet?: string;         // the text we found, shown as fine print
  menuDate?: string;        // when the menu itself is dated ("2024-05"), so people can judge how fresh it is
  reportedAt: string;       // ISO
  /** 'food' = a food price or deal from the same menu (burger $10, $1 wings). Missing = beer. Food never counts as a beer price. */
  category?: 'beer' | 'food';
  /** Food that comes with a beer ("Da Beef + craft beer $14"). */
  withBeer?: boolean;
  /** An add-on price, shown as "+$2" ("Burger combo: add a craft beer + fries"). */
  addOn?: boolean;
}

/** Happy hour window as found on a venue's website (may not list prices). */
export interface HappyHour {
  venueId: string;
  days: number[];
  start: string;
  end: string;
  text: string;
  source: BeerPriceSource;
  sourceUrl?: string;
}

export type BeerSort = 'best' | 'cheapest' | 'closest';

export interface RankedVenue {
  venue: BeerVenue;
  distanceMiles: number;
  bearing: number;          // degrees from north, clockwise
  isOpen: boolean | null;   // null = hours unknown
  hoursLabel?: string;      // "Open until 2 AM", "Opens 11 AM"
  closingSoon?: boolean;    // open, but closes within the hour
  /** Cheapest price that applies right now (happy hour/game day included). */
  best: (BeerPrice & { label: string }) | null;
  happyHourNow: boolean;
  happyHours: HappyHour[];
  prices: BeerPrice[];      // every beer price we know, cheapest first
  /** Food deals and prices from the same menus: happy-hour food and combos first, then cheapest. */
  food: BeerPrice[];
  score: number;
}

export interface BeerQuery {
  lat: number;
  lng: number;
  kind?: BeerVenueKind | 'all';
  openNow?: boolean;
  pricedOnly?: boolean;
  sort?: BeerSort;
  maxMiles?: number;
  limit?: number;
}

export interface BeerReport {
  venueId: string;
  item: string;
  price: number;
  currency?: 'USD' | 'EUR';
  size?: string;
  kind: BeerPriceKind;
  days?: number[];
  start?: string;
  end?: string;
  note?: string;
}
