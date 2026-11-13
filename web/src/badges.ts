import { useCallback, useEffect, useState } from 'react';
import { checkIn, dayKey, type Badge, type BadgeSide, type VisitLog } from '@gib/shared';

/**
 * Check-ins and badges live on this phone (localStorage), like the rest of the personal settings.
 * To check in you have to actually be there: live GPS, within CHECKIN_MILES of the place.
 */
export const CHECKIN_MILES = 0.2;
const KEY = 'gib.visits';
const EVENT = 'gib:visits';

export function loadVisits(): VisitLog {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as VisitLog; } catch { return {}; }
}

export function useVisits() {
  const [log, setLog] = useState<VisitLog>(loadVisits);
  useEffect(() => {
    const sync = () => setLog(loadVisits());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  /** Returns any badges this check-in just earned. */
  const visit = useCallback((place: { id: string; name: string; side: BadgeSide }): Badge[] => {
    const r = checkIn(loadVisits(), place, dayKey());
    if (r.added) {
      try { localStorage.setItem(KEY, JSON.stringify(r.log)); } catch { /* private mode: badge shows until reload */ }
      setLog(r.log);
      window.dispatchEvent(new Event(EVENT));
    }
    return r.newBadges;
  }, []);
  return { log, visit };
}
