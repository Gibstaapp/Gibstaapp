// ---- Beer side of the app (ported from the BeerFinder prototype) ----

export type BeerVenueKind = 'bar' | 'brewery' | 'store';

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
  price: number;            // dollars
  size?: string;            // "pint", "16oz", "6-pack"
  kind: BeerPriceKind;
  /** When this price applies. Missing = any time the venue is open. */
  days?: number[];          // 0 = Sunday … 6 = Saturday
  start?: string;           // "15:00"
  end?: string;             // "18:00" (may be < start for past-midnight)
  source: BeerPriceSource;
  sourceUrl?: string;
  snippet?: string;         // the text we found, shown as fine print
  reportedAt: string;       // ISO
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
  /** Cheapest price that applies right now (happy hour/game day included). */
  best: (BeerPrice & { label: string }) | null;
  happyHourNow: boolean;
  happyHours: HappyHour[];
  prices: BeerPrice[];      // everything we know, cheapest first
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
  size?: string;
  kind: BeerPriceKind;
  days?: number[];
  start?: string;
  end?: string;
  note?: string;
}
