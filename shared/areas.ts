// ---- Where Gibstaapp works: regions (U.S. / Europe) and the area codes people pick as "home". ----
import { ATHENS_POSTCODES } from './athens-postcodes.ts';
import { NYC_ZIPS } from './nyc-zips.ts';

/** 'us' is San Diego (the original region; the id stays for saved data). */
export type RegionId = 'us' | 'nyc' | 'europe';

export interface Region {
  id: RegionId;
  tab: string;               // tab label in the area-code picker
  city: string;              // the city we cover there
  codeName: string;          // what locals call the code
  currency: 'USD' | 'EUR';
  units: 'mi' | 'km';
  weedLegal: boolean;        // recreational cannabis legal (so the Weed side has shops to show)
  timeZone: string;
  /** Center for the daily refresh and how far it reaches (miles). */
  center: { lat: number; lng: number; miles: number };
  /** U.S. state whose cannabis taxes apply ('CA' San Diego, 'NY' New York). */
  taxState?: 'CA' | 'NY';
}

export const REGIONS: Record<RegionId, Region> = {
  us: { id: 'us', tab: '🌴 San Diego', city: 'San Diego', codeName: 'ZIP', currency: 'USD', units: 'mi', weedLegal: true, timeZone: 'America/Los_Angeles', center: { lat: 32.8566, lng: -117.2091, miles: 30 }, taxState: 'CA' },
  nyc: { id: 'nyc', tab: '🗽 New York', city: 'New York', codeName: 'ZIP', currency: 'USD', units: 'mi', weedLegal: true, timeZone: 'America/New_York', center: { lat: 40.7306, lng: -73.9352, miles: 20 }, taxState: 'NY' },
  europe: { id: 'europe', tab: '🇪🇺 Europe', city: 'Athens', codeName: 'postcode', currency: 'EUR', units: 'km', weedLegal: false, timeZone: 'Europe/Athens', center: { lat: 37.9838, lng: 23.7275, miles: 25 } },
};

export interface HomeArea { lat: number; lng: number; area: string; city: string; region: RegionId }

/** Approximate centroids for San Diego County ZIPs (kept local so your location isn't sent to a geocoding service). */
export const SD_ZIPS: Record<string, { lat: number; lng: number; area: string }> = {
  '92101': { lat: 32.7194, lng: -117.1628, area: 'Downtown' },
  '92102': { lat: 32.7157, lng: -117.1170, area: 'Golden Hill' },
  '92103': { lat: 32.7470, lng: -117.1680, area: 'Hillcrest' },
  '92104': { lat: 32.7400, lng: -117.1290, area: 'North Park' },
  '92105': { lat: 32.7375, lng: -117.0920, area: 'City Heights' },
  '92106': { lat: 32.7270, lng: -117.2320, area: 'Point Loma' },
  '92107': { lat: 32.7420, lng: -117.2440, area: 'Ocean Beach' },
  '92108': { lat: 32.7740, lng: -117.1420, area: 'Mission Valley' },
  '92109': { lat: 32.7940, lng: -117.2400, area: 'Pacific Beach' },
  '92110': { lat: 32.7660, lng: -117.2000, area: 'Morena / Midway' },
  '92111': { lat: 32.8050, lng: -117.1690, area: 'Linda Vista / Kearny Mesa' },
  '92113': { lat: 32.6970, lng: -117.1160, area: 'Logan Heights' },
  '92114': { lat: 32.7070, lng: -117.0550, area: 'Encanto' },
  '92115': { lat: 32.7610, lng: -117.0700, area: 'College Area' },
  '92116': { lat: 32.7650, lng: -117.1230, area: 'Normal Heights' },
  '92117': { lat: 32.8250, lng: -117.2000, area: 'Clairemont' },
  '92119': { lat: 32.8030, lng: -117.0280, area: 'San Carlos' },
  '92120': { lat: 32.7950, lng: -117.0720, area: 'Del Cerro' },
  '92121': { lat: 32.8990, lng: -117.2050, area: 'Sorrento Valley' },
  '92122': { lat: 32.8566, lng: -117.2091, area: 'University City' },
  '92123': { lat: 32.8090, lng: -117.1340, area: 'Serra Mesa' },
  '92124': { lat: 32.8270, lng: -117.0870, area: 'Tierrasanta' },
  '92126': { lat: 32.9160, lng: -117.1400, area: 'Mira Mesa' },
  '92127': { lat: 33.0200, lng: -117.1200, area: 'Rancho Bernardo W' },
  '92128': { lat: 32.9960, lng: -117.0720, area: 'Rancho Bernardo' },
  '92129': { lat: 32.9650, lng: -117.1220, area: 'Rancho Penasquitos' },
  '92130': { lat: 32.9550, lng: -117.2250, area: 'Carmel Valley' },
  '92131': { lat: 32.9120, lng: -117.0870, area: 'Scripps Ranch' },
  '92037': { lat: 32.8410, lng: -117.2560, area: 'La Jolla' },
  '91910': { lat: 32.6370, lng: -117.0670, area: 'Chula Vista' },
  '91911': { lat: 32.6080, lng: -117.0490, area: 'Chula Vista S' },
  '91950': { lat: 32.6700, lng: -117.0950, area: 'National City' },
  '91941': { lat: 32.7600, lng: -117.0100, area: 'La Mesa' },
  '91945': { lat: 32.7330, lng: -117.0330, area: 'Lemon Grove' },
  '92020': { lat: 32.7950, lng: -116.9700, area: 'El Cajon' },
  '92024': { lat: 33.0500, lng: -117.2600, area: 'Encinitas' },
  '92054': { lat: 33.1950, lng: -117.3700, area: 'Oceanside' },
  '92083': { lat: 33.1950, lng: -117.2500, area: 'Vista' },
  '92025': { lat: 33.1100, lng: -117.0700, area: 'Escondido' },
};

/** Tabs in the area-code picker, in order. */
export const REGION_ORDER: RegionId[] = ['us', 'nyc', 'europe'];

/** Every area code you can pick, with its region. U.S. ZIPs are 5 digits ("92122", "10003"); Athens postcodes are "105 58". */
export const AREAS: Record<string, HomeArea> = {
  ...Object.fromEntries(Object.entries(SD_ZIPS).map(([k, v]) => [k, { ...v, city: 'San Diego', region: 'us' as const }])),
  ...Object.fromEntries(Object.entries(NYC_ZIPS).map(([k, v]) => [k, { ...v, region: 'nyc' as const }])),
  ...Object.fromEntries(Object.entries(ATHENS_POSTCODES).map(([k, v]) => [k, { ...v, region: 'europe' as const }])),
};

export const regionOf = (homeZip: string | undefined): Region => REGIONS[(homeZip && AREAS[homeZip]?.region) || 'us'];

/** Each city's daily beer refresh owns these status lines (San Diego in dollars, Athens in euros). */
export const BEER_STATUS_SOURCES: Record<RegionId, string[]> = { us: ['osm', 'bar-websites'], nyc: ['nyc-places', 'nyc-bar-websites'], europe: ['athens-places', 'athens-menus'] };

/** Each weed city has its own data file on the website, so a phone only downloads its own city. */
export const WEED_FILES: Partial<Record<RegionId, string>> = { us: 'weed.json', nyc: 'weed-nyc.json' };

/** Nothing farther than this from your home area code is ever shown (keeps San Diego and Athens apart). */
export const MAX_RESULT_MILES = 100;

/** Which region a place is in, from its location: Greece = Europe (Athens), the New York area = New York, else San Diego. */
export const regionAt = (p: { lat: number; lng: number }): Region =>
  REGIONS[p.lat > 34.5 && p.lat < 42 && p.lng > 19 && p.lng < 30 ? 'europe'
    : p.lat > 40.3 && p.lat < 41.3 && p.lng > -74.6 && p.lng < -73.2 ? 'nyc' : 'us'];

// ---- units & money, so both regions read naturally ----
export const KM_PER_MI = 1.609344;
const toUnits = (miles: number, units: Region['units']) => (units === 'km' ? miles * KM_PER_MI : miles);

/** "4.3 mi" / "6.9 km". */
export function fmtDistance(miles: number, units: Region['units'], digits = 1): string {
  return `${toUnits(miles, units).toFixed(digits)} ${units}`;
}
/** Short distance for the compass: feet/metres up close. */
export function fmtNear(miles: number, units: Region['units']): string {
  if (units === 'km') {
    const km = miles * KM_PER_MI;
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  }
  return miles < 0.1 ? `${Math.round(miles * 5280)} ft` : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
/** Distance-filter choices in the region's units, as [miles, label]. */
export function distanceChoices(units: Region['units'], mi: number[], km: number[]): [number, string][] {
  return units === 'km' ? km.map((k) => [k / KM_PER_MI, `≤ ${k} km`]) : mi.map((m) => [m, `≤ ${m} mi`]);
}
export const CURRENCY_SYMBOL = { USD: '$', EUR: '€' } as const;
