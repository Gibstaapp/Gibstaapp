import OpeningHours from 'opening_hours';
import type { OpenStatus } from '@gib/shared';

/**
 * Opening hours for weed stores and beer places, in OpenStreetMap opening_hours syntax
 * ("Mo-Fr 11:00-02:00; Sa,Su 10:00-02:00"). Browser-safe: the static website runs this on the phone.
 */
const NOMINATIM = { lat: 32.72, lon: -117.16, address: { country_code: 'us', state: 'California' } };
const cache = new Map<string, OpeningHours | null>();

/** "Closing soon" = open, and closes within this many minutes. */
export const CLOSING_SOON_MINUTES = 60;

function parse(value: string): OpeningHours | null {
  if (cache.has(value)) return cache.get(value)!;
  let oh: OpeningHours | null = null;
  try { oh = new OpeningHours(value, NOMINATIM as any); } catch { oh = null; }
  cache.set(value, oh);
  return oh;
}

const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).replace(':00', '');

/** Open right now? Plus a short label: "Open until 10 PM", "Closes 9:55 PM" (closing soon), "Opens Sat 8 AM". */
export function openState(value: string | undefined, now = new Date()): OpenStatus {
  if (!value) return { isOpen: null };
  if (/^24\/7$/.test(value.trim())) return { isOpen: true, label: 'Open 24/7' };
  const oh = parse(value);
  if (!oh) return { isOpen: null };
  try {
    const isOpen = oh.getState(now);
    const next = oh.getNextChange(now) as Date | undefined;
    if (!next) return { isOpen, label: isOpen ? 'Open 24/7' : 'Closed' };
    const minsLeft = (next.getTime() - now.getTime()) / 60_000;
    const sameDay = next.toDateString() === now.toDateString() || minsLeft < 12 * 60;
    const when = sameDay ? fmtTime(next) : `${next.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })} ${fmtTime(next)}`;
    if (!isOpen) return { isOpen, label: `Opens ${when}` };
    const closingSoon = minsLeft <= CLOSING_SOON_MINUTES;
    return { isOpen, label: closingSoon ? `Closes ${when}` : `Open until ${when}`, ...(closingSoon ? { closingSoon } : {}) };
  } catch {
    return { isOpen: null };
  }
}

const OSM_DAYS: [string, string][] = [
  ['monday', 'Mo'], ['tuesday', 'Tu'], ['wednesday', 'We'], ['thursday', 'Th'], ['friday', 'Fr'], ['saturday', 'Sa'], ['sunday', 'Su'],
];

/** "6:00am" / "9:55 PM" / "12:00am" -> "06:00" / "21:55" / "00:00". */
export function to24h(t: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*$/i.exec(t);
  if (!m) return null;
  const h = Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Weekly hours as listing sites give them ({ monday: { open: "8:00am", close: "10:00pm" }, ... })
 * -> opening_hours text. Closed or unlisted days are left out, which opening_hours reads as closed.
 * Returns undefined when nothing usable is there.
 */
export function weeklyHoursToOsm(week: Record<string, { open?: string | null; close?: string | null; is_closed?: boolean | null } | null | undefined> | null | undefined): string | undefined {
  if (!week || typeof week !== 'object') return undefined;
  const parts: string[] = [];
  let anyOpen = false;
  for (const [day, osm] of OSM_DAYS) {
    const d = week[day];
    if (!d) continue;
    // Closed days are simply left out (unlisted = closed). Writing "Su off" would also cancel
    // Saturday's hours that run past midnight into Sunday.
    if (d.is_closed) continue;
    const open = d.open ? to24h(d.open) : null, close = d.close ? to24h(d.close) : null;
    if (!open || !close) continue;
    anyOpen = true;
    // Same open and close time ("12:00am-12:00am") = open all day. Close before open = past midnight, which opening_hours handles.
    parts.push(`${osm} ${open === close ? '00:00-24:00' : `${open}-${close === '00:00' ? '24:00' : close}`}`);
  }
  if (!anyOpen) return undefined;
  const text = parts.join('; ');
  return parse(text) ? text : undefined;
}
