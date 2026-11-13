// ---- Badges: come back to the same place 5+ times and earn one. Pure logic; the phone stores the log. ----

export type BadgeSide = 'weed' | 'beer';

/** Every day you checked in at one place. One check-in per place per day. */
export interface VisitRecord {
  id: string;        // store id or venue id
  name: string;
  side: BadgeSide;
  days: string[];    // local dates, "2026-11-13"
}
export type VisitLog = Record<string, VisitRecord>;

export interface BadgeTier { visits: number; emoji: string; title: string; blurb: string }

/** Visits to ONE place. The first badge comes at 5. */
export const BADGE_TIERS: Record<BadgeSide, BadgeTier[]> = {
  weed: [
    { visits: 5, emoji: '🌿', title: 'Bud Buddy', blurb: 'Five trips. They know your order.' },
    { visits: 10, emoji: '🔥', title: 'Certified Regular', blurb: 'Ten trips. You have a favorite parking spot.' },
    { visits: 25, emoji: '👑', title: 'Kush Royalty', blurb: 'Twenty-five trips. Basically on the payroll.' },
  ],
  beer: [
    { visits: 5, emoji: '🍺', title: 'The Regular', blurb: 'Five visits. "The usual?"' },
    { visits: 10, emoji: '🍻', title: 'Barfly', blurb: 'Ten visits. Your stool misses you.' },
    { visits: 25, emoji: '👑', title: 'Mayor of the Bar', blurb: 'Twenty-five visits. Name on a plaque soon.' },
  ],
};
/** Different places visited on one side. */
export const EXPLORER_TIERS: Record<BadgeSide, BadgeTier[]> = {
  weed: [{ visits: 5, emoji: '🧭', title: 'Trailblazer', blurb: 'Checked in at five different shops.' }],
  beer: [{ visits: 5, emoji: '🧭', title: 'Pub Crawler', blurb: 'Checked in at five different spots.' }],
};
export const FIRST_BADGE_VISITS = BADGE_TIERS.weed[0].visits;

export interface Badge extends BadgeTier {
  key: string;           // unique: "place:<id>:5" or "explorer:weed:5"
  side: BadgeSide;
  place?: string;        // place name, for per-place badges
  count: number;         // visits (or places) so far
}

const tierFor = (tiers: BadgeTier[], n: number) => [...tiers].reverse().find((t) => n >= t.visits);

/** Highest badge earned at one place, if any. */
export function placeBadge(rec: VisitRecord | undefined): Badge | null {
  if (!rec) return null;
  const t = tierFor(BADGE_TIERS[rec.side], rec.days.length);
  return t ? { ...t, key: `place:${rec.id}:${t.visits}`, side: rec.side, place: rec.name, count: rec.days.length } : null;
}

/** Visits still needed for the next badge at this place (null = top badge already earned). */
export function visitsToNext(side: BadgeSide, visits: number): { need: number; tier: BadgeTier } | null {
  const next = BADGE_TIERS[side].find((t) => visits < t.visits);
  return next ? { need: next.visits - visits, tier: next } : null;
}

/** Every badge earned so far, best first. */
export function earnedBadges(log: VisitLog): Badge[] {
  const out: Badge[] = [];
  for (const rec of Object.values(log)) { const b = placeBadge(rec); if (b) out.push(b); }
  for (const side of ['weed', 'beer'] as const) {
    const places = Object.values(log).filter((r) => r.side === side && r.days.length > 0).length;
    const t = tierFor(EXPLORER_TIERS[side], places);
    if (t) out.push({ ...t, key: `explorer:${side}:${t.visits}`, side, count: places });
  }
  return out.sort((a, b) => b.visits - a.visits || b.count - a.count);
}

/** Record today's visit. Checking in twice on the same day doesn't count twice. */
export function checkIn(log: VisitLog, place: { id: string; name: string; side: BadgeSide }, day: string): { log: VisitLog; added: boolean; visits: number; newBadges: Badge[] } {
  const prev = log[place.id];
  if (prev?.days.includes(day)) return { log, added: false, visits: prev.days.length, newBadges: [] };
  const rec: VisitRecord = { id: place.id, name: place.name, side: place.side, days: [...(prev?.days ?? []), day] };
  const next = { ...log, [place.id]: rec };
  const had = new Set(earnedBadges(log).map((b) => b.key));
  return { log: next, added: true, visits: rec.days.length, newBadges: earnedBadges(next).filter((b) => !had.has(b.key)) };
}

/** Local calendar day, "2026-11-13". */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
