import OpeningHours from 'opening_hours';

/** Parse OSM opening_hours. Returns null when we can't tell. */
const NOMINATIM = { lat: 32.72, lon: -117.16, address: { country_code: 'us', state: 'California' } };
const cache = new Map<string, OpeningHours | null>();

function parse(value: string): OpeningHours | null {
  if (cache.has(value)) return cache.get(value)!;
  let oh: OpeningHours | null = null;
  try { oh = new OpeningHours(value, NOMINATIM as any); } catch { oh = null; }
  cache.set(value, oh);
  return oh;
}

const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).replace(':00', '');

export function openState(value: string | undefined, now = new Date()): { isOpen: boolean | null; label?: string } {
  if (!value) return { isOpen: null };
  if (/^24\/7$/.test(value.trim())) return { isOpen: true, label: 'Open 24/7' };
  const oh = parse(value);
  if (!oh) return { isOpen: null };
  try {
    const isOpen = oh.getState(now);
    const next = oh.getNextChange(now) as Date | undefined;
    let label: string | undefined;
    if (next) {
      const sameDay = next.toDateString() === now.toDateString() || next.getTime() - now.getTime() < 12 * 3600_000;
      const when = sameDay ? fmtTime(next) : `${next.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })} ${fmtTime(next)}`;
      label = isOpen ? `Open until ${when}` : `Opens ${when}`;
    } else {
      label = isOpen ? 'Open' : 'Closed';
    }
    return { isOpen, label };
  } catch {
    return { isOpen: null };
  }
}

/** "15:00" -> minutes since midnight */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Is a days/start/end window active now? Past-midnight windows (end < start) count for the day they started. */
export function windowActive(w: { days?: number[]; start?: string; end?: string }, now = new Date()): boolean {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const days = w.days?.length ? w.days : [0, 1, 2, 3, 4, 5, 6];
  if (!w.start || !w.end) return days.includes(day);
  const s = toMinutes(w.start), e = toMinutes(w.end);
  if (e > s) return days.includes(day) && mins >= s && mins < e;
  // wraps midnight
  if (mins >= s) return days.includes(day);
  return mins < e && days.includes((day + 6) % 7);
}

export function bearingDegrees(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(bLng - aLng)) * Math.cos(r(bLat));
  const x = Math.cos(r(aLat)) * Math.sin(r(bLat)) - Math.sin(r(aLat)) * Math.cos(r(bLat)) * Math.cos(r(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
