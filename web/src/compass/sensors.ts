import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Compass + GPS in the browser.
 *
 * - Android Chrome / the Android app: `deviceorientationabsolute` gives a north-referenced alpha.
 * - iPhone Safari: `webkitCompassHeading`, but only after the user taps a button
 *   (DeviceOrientationEvent.requestPermission) and only on https.
 * - Desktop / no sensor: heading stays null and the arrow is drawn north-up.
 *
 * Both need a secure page (https or localhost). The public trycloudflare link is https.
 */

/** Shortest signed difference b - a in degrees, in [-180, 180). Same math as the Kotlin CompassMath. */
export const shortestArc = (a: number, b: number) => ((((b - a + 540) % 360) + 360) % 360) - 180;
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

export function bearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(bLng - aLng)) * Math.cos(r(bLat));
  const x = Math.cos(r(aLat)) * Math.sin(r(bLat)) - Math.sin(r(aLat)) * Math.cos(r(bLat)) * Math.cos(r(bLng - aLng));
  return norm360((Math.atan2(y, x) * 180) / Math.PI);
}

const screenAngle = () => (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;

export type HeadingState =
  | { status: 'live'; heading: number }
  | { status: 'needs-permission' }
  | { status: 'waiting' }
  | { status: 'unavailable'; reason: string };

export function useHeading(): { state: HeadingState; requestPermission: () => Promise<void> } {
  const iosPermission = typeof (window as any).DeviceOrientationEvent?.requestPermission === 'function';
  const [granted, setGranted] = useState(!iosPermission || localStorage.getItem('gib.compassOk') === '1');
  const [state, setState] = useState<HeadingState>(granted ? { status: 'waiting' } : { status: 'needs-permission' });
  const smooth = useRef<number | null>(null);

  useEffect(() => {
    if (!granted) return;
    if (!window.isSecureContext) { setState({ status: 'unavailable', reason: 'Compass needs the https link.' }); return; }
    if (!('DeviceOrientationEvent' in window)) { setState({ status: 'unavailable', reason: 'No compass on this device.' }); return; }
    let got = false;
    let last = 0;
    const publish = (raw: number) => {
      got = true;
      const h = norm360(raw + screenAngle());
      smooth.current = smooth.current == null ? h : norm360(smooth.current + shortestArc(smooth.current, h) * 0.3);
      const now = performance.now();
      if (now - last > 40) { last = now; setState({ status: 'live', heading: smooth.current }); }
    };
    const onAbsolute = (e: DeviceOrientationEvent) => { if (e.alpha != null) publish(360 - e.alpha); };
    const onRelative = (e: DeviceOrientationEvent) => {
      const ios = (e as any).webkitCompassHeading as number | undefined;
      if (typeof ios === 'number' && !Number.isNaN(ios)) publish(ios);
      else if (e.absolute && e.alpha != null) publish(360 - e.alpha);
    };
    window.addEventListener('deviceorientationabsolute' as any, onAbsolute);
    window.addEventListener('deviceorientation', onRelative);
    const t = setTimeout(() => { if (!got) setState({ status: 'unavailable', reason: 'No compass sensor found (normal on a computer).' }); }, 3000);
    return () => {
      clearTimeout(t);
      window.removeEventListener('deviceorientationabsolute' as any, onAbsolute);
      window.removeEventListener('deviceorientation', onRelative);
    };
  }, [granted]);

  const requestPermission = useCallback(async () => {
    try {
      const r = await (window as any).DeviceOrientationEvent.requestPermission();
      if (r === 'granted') { localStorage.setItem('gib.compassOk', '1'); setGranted(true); setState({ status: 'waiting' }); }
      else setState({ status: 'unavailable', reason: 'Compass permission was denied. Allow Motion & Orientation in Safari settings.' });
    } catch (e) {
      setState({ status: 'unavailable', reason: String((e as Error).message ?? e) });
    }
  }, []);

  return { state, requestPermission };
}

export interface Fix { lat: number; lng: number; accuracy?: number; source: 'gps' | 'home' }

/** Live GPS position, falling back to the home ZIP. */
export function useLocation(home: { lat: number; lng: number }): { fix: Fix; error: string | null; retry: () => void } {
  const [fix, setFix] = useState<Fix>({ ...home, source: 'home' });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!navigator.geolocation) { setError('This browser has no location access.'); return; }
    if (!window.isSecureContext) { setError('Location needs the https link. Using your home ZIP.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setError(null); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'gps' }); },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Using your home ZIP.' : 'Can\'t get a GPS fix. Using your home ZIP.'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [attempt]);
  useEffect(() => { setFix((f) => (f.source === 'home' ? { ...home, source: 'home' } : f)); }, [home.lat, home.lng]);
  return { fix, error, retry: () => setAttempt((a) => a + 1) };
}

/** Google Maps directions (opens the Maps app on Android and iPhone). */
export const directionsUrl = (lat: number, lng: number, mode: 'walking' | 'driving' = 'driving') =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`;
