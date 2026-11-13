// Shared types used by both server and web.

export type Category = 'flower' | 'preroll' | 'vape' | 'concentrate' | 'edible' | 'other';
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'flower', label: 'Flower' },
  { id: 'preroll', label: 'Pre-rolls' },
  { id: 'vape', label: 'Carts / Vapes' },
  { id: 'concentrate', label: 'Concentrates' },
  { id: 'edible', label: 'Edibles' },
  { id: 'other', label: 'Other' },
];

export type SourceId = 'dutchie' | 'jane' | 'weedmaps' | 'eaze' | 'sample';
export type DeliveryVia = 'weedmaps' | 'eaze' | 'store';

export interface SourceRef {
  source: SourceId;
  externalId: string;
  url?: string;
}

export interface DeliveryOption {
  via: DeliveryVia;
  fee: number;          // $ per order
  minimum: number;      // minimum order $
  etaMinutes?: number;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  city: string;          // used to look up local taxes
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
  menuUrl?: string;      // the store's own online menu, if any
  sources: SourceRef[];
  pickup: boolean;       // offers in-store pickup at all
  ownSitePickup: boolean | null;  // can order pickup on the store's own site (not Weedmaps/Eaze). null = unknown
  taxIncluded: boolean | null;    // listed prices already include taxes. null = unknown
  delivery: DeliveryOption[];
  hours?: string;        // OpenStreetMap opening_hours syntax, e.g. "Mo 08:00-22:00; Tu 08:00-22:00"
}

/** Is a place open right now? Same shape for weed stores and beer places. */
export interface OpenStatus {
  isOpen: boolean | null;   // null = hours unknown
  label?: string;           // "Open until 10 PM", "Closes 9:55 PM", "Opens Sat 8 AM"
  closingSoon?: boolean;    // open, but closes within the hour
}

export interface StoreOverride {
  storeId: string;
  taxIncluded?: boolean | null;
  ownSitePickup?: boolean | null;
  hidden?: boolean;
}

export interface Product {
  id: string;
  storeId: string;
  source: SourceId;
  name: string;
  brand?: string;
  category: Category;
  grams?: number;        // net weight; for vapes = oil grams
  thcMg?: number;        // edibles / tinctures: total THC mg
  unitCount?: number;    // e.g. 5-pack of pre-rolls
  thcPct?: number;
  strainType?: 'indica' | 'sativa' | 'hybrid' | 'cbd';
  price: number;         // listed price before deals
  url?: string;
  // Sale price the menu already shows (a deal baked into the menu); the engine treats it as a deal.
  salePrice?: number;
  saleLabel?: string;
}

export type DealKind = 'percent' | 'amount' | 'fixed' | 'bundle' | 'bogo';
export type Audience = 'everyone' | 'first_time' | 'veteran' | 'senior' | 'student';

export interface DealConditions {
  minSpend?: number;
  limitPerCustomer?: number;
  inStoreOnly?: boolean;
  pickupOnly?: boolean;
  deliveryOnly?: boolean;
  cashOnly?: boolean;
  idRequired?: boolean;
  expiresAt?: string;     // ISO date
  minThcPct?: number;
}

export interface DealTarget {
  categories?: Category[];
  brands?: string[];        // case-insensitive match
  productIds?: string[];
  nameIncludes?: string[];  // case-insensitive substring match
  excludeBrands?: string[];
  minGrams?: number;
  maxGrams?: number;
}

export interface Deal {
  id: string;
  storeId: string;
  source: SourceId;
  title: string;            // e.g. "Wax Wednesday"
  kind: DealKind;
  value?: number;           // percent: 0-100; amount: $ off; fixed: final price
  bundleQty?: number;       // bundle: "3 for $60" -> qty 3, price 60
  bundlePrice?: number;
  bogoBuy?: number;         // bogo: buy N ...
  bogoGetPct?: number;      // ... get 1 at X% off (100 = free)
  audience: Audience;
  days?: number[];          // 0=Sun..6=Sat; omitted = every day
  appliesTo: DealTarget;
  conditions: DealConditions;
  finePrint?: string;       // raw text from the source
  stackable?: boolean;      // can combine with an audience discount (vet/senior/student)
}

export interface UserProfile {
  homeZip: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  veteran: boolean;
  senior: boolean;
  student: boolean;
  visitedStoreIds: string[];
  onboarded: boolean;
  ntfyTopic?: string;
  notifyHour: number;       // 0-23, local time
}

export type Mode = 'pickup' | 'delivery';

export interface FinePrintItem {
  text: string;
  important: boolean;
}

export interface AppliedDeal {
  dealId: string;
  title: string;
  kind: DealKind;
  audience: Audience;
  savings: number;          // $ saved per unit vs list
  effectiveUnitPrice: number;
  requiresQty?: number;     // bundle/bogo: units you must buy for this price
}

export interface TaxBreakdown {
  local: number;
  excise: number;
  sales: number;
  total: number;
  estimated: boolean;       // false when the store's prices include tax
  included: boolean;
}

export interface PricedItem {
  product: Product;
  store: Store;
  mode: Mode;
  deliveryVia?: DeliveryVia;
  listPrice: number;
  deal?: AppliedDeal;               // best deal that applies to this user
  usesFirstTime: boolean;           // `deal` depends on a first-time discount
  regularOtd?: number;              // OTD without first-time deals (shown next to the first-timer price)
  regularDeal?: AppliedDeal;
  priceAfterDeals: number;
  tax: TaxBreakdown;
  deliveryFee: number;
  deliveryMinimum?: number;
  otd: number;                      // out-the-door per unit
  perUnit: number;                  // $/g or $/100mg THC
  unitLabel: '/g' | '/100mg' | '/ea';
  distanceMiles: number;
  open: OpenStatus;                 // the store's hours right now
  finePrint: FinePrintItem[];
  // Set when this item is a "closer pick": ≥5 mi closer than the cheapest same-size option and ≤$10 more.
  closerPick?: {
    milesCloser: number;
    extraCost: number;
    vsStore: string;
    vsOtd: number;
    vsMiles: number;
  };
}

export interface SourceStatus {
  source: SourceId | 'osm' | 'bar-websites';
  ok: boolean;
  stores: number;
  products: number;
  error?: string;
  finishedAt: string;
}

export interface RefreshStatus {
  running: boolean;
  throttled?: boolean;      // refresh skipped: data is fresh enough
  nextAllowedAt?: string;
  lastRefreshAt?: string;
  sources: SourceStatus[];
}
export * from './beer.ts';
export * from './badges.ts';
export * from './areas.ts';
export * from './athens-postcodes.ts';
