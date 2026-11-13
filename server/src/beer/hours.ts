/** Opening hours now live in ../hours.ts (shared with weed stores). */
export { openState } from '../hours.ts';

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
