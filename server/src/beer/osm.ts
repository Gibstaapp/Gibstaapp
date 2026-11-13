import type { BeerVenue, BeerVenueKind } from '@gib/shared';

/**
 * Bars, pubs, breweries and liquor stores across San Diego from OpenStreetMap (free, legal, no key).
 * Overpass servers are busy sometimes, so we try a few mirrors.
 */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Bounding box around a point: 'south,west,north,east'. */
export function bboxAround(lat: number, lng: number, miles: number): string {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((x) => x.toFixed(4)).join(',');
}

const queryFor = (bbox: string) => `[out:json][timeout:120];
(
  nwr["amenity"~"^(bar|pub|biergarten)$"](${bbox});
  nwr["craft"="brewery"](${bbox});
  nwr["microbrewery"="yes"](${bbox});
  nwr["shop"~"^(alcohol|beverages)$"](${bbox});
);
out center tags;`;

interface OsmEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export function kindOf(t: Record<string, string>): BeerVenueKind {
  if (t.craft === 'brewery' || t.microbrewery === 'yes' || /brew/i.test(t.name ?? '')) return 'brewery';
  if (t.shop) return 'store';
  return 'bar';
}

export function toVenue(e: OsmEl): BeerVenue | null {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (!t.name || lat == null || lng == null) return null;
  if (t.disused || t['disused:amenity'] || t.opening_hours === 'closed' || t.opening_hours === 'off') return null;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const city = t['addr:city'];
  let website = t.website ?? t['contact:website'] ?? t.url;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return {
    id: `osm:${e.type}/${e.id}`,
    name: t.name,
    kind: kindOf(t),
    lat, lng,
    address: street ? [street, city].filter(Boolean).join(', ') : undefined,
    city,
    website,
    phone: t.phone ?? t['contact:phone'],
    openingHours: t.opening_hours,
    source: 'osm',
  };
}

/** All beer places within ~miles of a point (works anywhere OpenStreetMap has data, which is most places). */
export async function fetchOsmVenues(area: { lat: number; lng: number; miles: number }, log: (m: string) => void = () => {}): Promise<BeerVenue[]> {
  const query = queryFor(bboxAround(area.lat, area.lng, area.miles));
  let lastErr: unknown;
  // Overpass servers are often busy for a minute: go through the mirrors twice, with a pause.
  for (const [round, url] of [...MIRRORS.map((u) => [0, u] as const), ...MIRRORS.map((u) => [1, u] as const)]) {
    if (round === 1 && url === MIRRORS[0]) await new Promise((r) => setTimeout(r, 20_000));
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': 'gibstaapp/0.1 (personal deal finder)' },
        signal: AbortSignal.timeout(150_000),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{')) throw new Error(`${res.status} ${text.slice(0, 80)}`);
      const els = (JSON.parse(text).elements ?? []) as OsmEl[];
      const venues = els.map(toVenue).filter((v): v is BeerVenue => !!v);
      log(`${url}: ${venues.length} venues`);
      return dedupe(venues);
    } catch (e) {
      lastErr = e;
      log(`${url} failed: ${(e as Error).message}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all Overpass mirrors failed');
}

/** The same place is often mapped as both a node and a building; keep the one with more info. */
export function dedupe(vs: BeerVenue[]): BeerVenue[] {
  const out: BeerVenue[] = [];
  const score = (v: BeerVenue) => +!!v.website + +!!v.openingHours + +!!v.address;
  // Letters in any alphabet: Greek names ("Μπυραρία") would otherwise all reduce to "" and be merged.
  const keyOf = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
  for (const v of vs) {
    const key = keyOf(v.name);
    const i = out.findIndex((o) => keyOf(o.name) === key && Math.abs(o.lat - v.lat) < 0.002 && Math.abs(o.lng - v.lng) < 0.002);
    if (i < 0) out.push(v);
    else if (score(v) > score(out[i])) out[i] = v;
  }
  return out;
}
