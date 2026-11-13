import type { PricedItem, UserProfile } from '@gib/shared';
import { repo } from './db.ts';
import { rankItems, type RankQuery } from './pricing/engine.ts';
import { SD_ZIPS } from './zips.ts';

/** Per-person settings each phone keeps for itself (the rest of the profile is server-wide). */
export type PersonalProfile = Pick<UserProfile, 'homeZip' | 'radiusMiles' | 'veteran' | 'senior' | 'student' | 'visitedStoreIds'>;

export function profileFor(personal?: Partial<PersonalProfile>): UserProfile {
  const base = repo.profile();
  if (!personal) return base;
  const p: UserProfile = { ...base };
  if (typeof personal.veteran === 'boolean') p.veteran = personal.veteran;
  if (typeof personal.senior === 'boolean') p.senior = personal.senior;
  if (typeof personal.student === 'boolean') p.student = personal.student;
  if (Array.isArray(personal.visitedStoreIds)) p.visitedStoreIds = personal.visitedStoreIds.filter((x) => typeof x === 'string').slice(0, 500);
  if (typeof personal.radiusMiles === 'number' && personal.radiusMiles > 0) p.radiusMiles = Math.min(personal.radiusMiles, 100);
  const z = personal.homeZip ? SD_ZIPS[personal.homeZip] : undefined;
  if (z) { p.homeZip = personal.homeZip!; p.lat = z.lat; p.lng = z.lng; }
  return p;
}

/** Rank the stored catalog for a profile (defaults to the server's saved profile). */
export function query(q: RankQuery, profile: UserProfile = repo.profile()): PricedItem[] {
  const stores = new Map(repo.stores().map((s) => [s.id, s]));
  const overrides = new Map(repo.overrides().map((o) => [o.storeId, o]));
  return rankItems(repo.products(), stores, repo.deals(), overrides, profile, q);
}
