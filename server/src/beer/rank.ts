import type { BeerPrice, BeerQuery, BeerVenue, HappyHour, RankedVenue } from '@gib/shared';
import { haversineMiles } from '../pricing/engine.ts';
import { bearingDegrees, openState, windowActive } from './hours.ts';

/** Fluid ounces for a size label, so a $3 can and a $6 pint can be compared fairly. */
export function ouncesOf(size?: string): number {
  if (!size) return 16;
  const s = size.toLowerCase();
  const pack = /(\d+)\s*-?\s*(?:pack|pk)/.exec(s);
  const oz = /(\d+(?:\.\d+)?)\s*oz/.exec(s);
  if (pack) return +pack[1] * (oz ? +oz[1] : 12);
  if (oz) return +oz[1];
  if (/pint/.test(s)) return 16;
  if (/tall ?boy|24/.test(s)) return 24;
  if (/can|bottle/.test(s)) return 12;
  if (/pitcher/.test(s)) return 60;
  return 16;
}

/** Price scaled to a 16 oz pint. */
export const perPint = (p: Pick<BeerPrice, 'price' | 'size'>) => (p.price * 16) / ouncesOf(p.size);

export function priceAppliesNow(p: BeerPrice, now: Date): boolean {
  if (p.kind === 'regular' && !p.start) return p.days?.length ? windowActive(p, now) : true;
  return windowActive(p, now);
}

const LABEL: Record<BeerPrice['kind'], string> = { regular: 'Regular price', happy_hour: 'Happy hour', special: 'Daily special' };

export function rankVenues(
  q: BeerQuery,
  venues: BeerVenue[],
  prices: BeerPrice[],
  happyHours: HappyHour[],
  now = new Date(),
): RankedVenue[] {
  const byVenue = new Map<string, BeerPrice[]>();
  for (const p of prices) (byVenue.get(p.venueId) ?? byVenue.set(p.venueId, []).get(p.venueId)!).push(p);
  const hhByVenue = new Map<string, HappyHour[]>();
  for (const h of happyHours) (hhByVenue.get(h.venueId) ?? hhByVenue.set(h.venueId, []).get(h.venueId)!).push(h);

  const out: RankedVenue[] = [];
  for (const v of venues) {
    if (q.kind && q.kind !== 'all' && v.kind !== q.kind) continue;
    const distanceMiles = haversineMiles(q.lat, q.lng, v.lat, v.lng);
    if (q.maxMiles && distanceMiles > q.maxMiles) continue;
    const { isOpen, label: hoursLabel, closingSoon } = openState(v.openingHours, now);
    if (q.openNow && isOpen === false) continue;

    const vp = (byVenue.get(v.id) ?? []).slice().sort((a, b) => perPint(a) - perPint(b));
    const hh = hhByVenue.get(v.id) ?? [];
    const applicable = vp.filter((p) => priceAppliesNow(p, now));
    const best = applicable[0] ? { ...applicable[0], label: LABEL[applicable[0].kind] } : null;
    if (q.pricedOnly && !best) continue;
    out.push({
      venue: v,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
      bearing: Math.round(bearingDegrees(q.lat, q.lng, v.lat, v.lng) * 10) / 10,
      isOpen,
      hoursLabel,
      ...(closingSoon ? { closingSoon } : {}),
      best,
      happyHourNow: hh.some((h) => windowActive(h, now)) || applicable.some((p) => p.kind === 'happy_hour'),
      happyHours: hh,
      prices: vp,
      score: 0,
    });
  }

  // Score (lower is better). Unknown price = typical price + a penalty, so priced places win ties.
  const known = out.filter((r) => r.best).map((r) => perPint(r.best!)).sort((a, b) => a - b);
  const typical = known.length ? known[Math.floor(known.length / 2)] : 7;
  const sort = q.sort ?? 'best';
  for (const r of out) {
    const price = r.best ? perPint(r.best) : typical + 2;
    const closedPenalty = r.isOpen === false ? 1000 : 0;
    // "Open now": places we know are open come first; places with no hours listed (most of OpenStreetMap) after them.
    const unknownPenalty = q.openNow && r.isOpen === null ? 100 : 0;
    r.score = closedPenalty + unknownPenalty +(sort === 'closest' ? r.distanceMiles : sort === 'cheapest' ? price + r.distanceMiles * 0.01 + (r.best ? 0 : 500) : price * 0.5 + r.distanceMiles * 0.5 + (r.happyHourNow ? -0.5 : 0));
  }
  out.sort((a, b) => a.score - b.score);
  return out.slice(0, q.limit ?? 150);
}
