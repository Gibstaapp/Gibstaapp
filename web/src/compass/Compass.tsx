import { useRef, type ReactNode } from 'react';
import { haversine } from '../geo.ts';
import { bearing, directionsUrl, shortestArc, useHeading, type Fix } from './sensors.ts';

export interface CompassTarget {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Big line under the name: price, deal… */
  headline?: ReactNode;
  /** Small lines: open status, address… */
  detail?: ReactNode;
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (d: number) => CARD[Math.round(d / 45) % 8];
const fmtMiles = (mi: number) => (mi < 0.1 ? `${Math.round(mi * 5280)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`);

/** Keeps a rotation continuous (no 359° -> 0° spin) by accumulating shortest-arc steps. */
function useUnwrapped(angle: number) {
  const acc = useRef<number | null>(null);
  if (acc.current == null) acc.current = angle;
  else acc.current += shortestArc(acc.current, angle);
  return acc.current;
}

export default function Compass({ fix, target, accent = '#22c55e', onPrev, onNext, position, locationError, onRetryLocation }: {
  fix: Fix;
  target: CompassTarget | null;
  accent?: string;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;      // "2 of 40"
  locationError?: string | null;
  onRetryLocation?: () => void;
}) {
  const { state, requestPermission } = useHeading();
  const heading = state.status === 'live' ? state.heading : 0;
  const brg = target ? bearing(fix.lat, fix.lng, target.lat, target.lng) : 0;
  const dist = target ? haversine(fix.lat, fix.lng, target.lat, target.lng) : 0;
  const dialRot = useUnwrapped(-heading);
  const needleRot = useUnwrapped(brg - heading);
  const arrived = target && fix.source === 'gps' && dist < 0.03;
  const facing = state.status === 'live' && Math.abs(shortestArc(heading, brg)) < 12;

  return (
    <div className="flex flex-col items-center px-4 pt-4 pb-6 gap-4">
      {/* Dial */}
      <div className="relative w-[min(78vw,340px)] aspect-square select-none">
        <div className="absolute inset-0 rounded-full border-2 border-zinc-700 bg-zinc-900/70 shadow-[inset_0_0_40px_rgba(0,0,0,.6)]"
          style={{ transform: `rotate(${dialRot}deg)`, transition: 'transform 120ms linear' }}>
          {Array.from({ length: 72 }, (_, i) => (
            <div key={i} className="absolute left-1/2 top-0 h-1/2 origin-bottom" style={{ transform: `translateX(-50%) rotate(${i * 5}deg)` }}>
              <div className={`mx-auto ${i % 18 === 0 ? 'w-[3px] h-4 bg-zinc-300' : i % 2 === 0 ? 'w-px h-2.5 bg-zinc-500' : 'w-px h-1.5 bg-zinc-700'}`} />
            </div>
          ))}
          {(['N', 'E', 'S', 'W'] as const).map((c, i) => (
            <div key={c} className="absolute left-1/2 top-0 h-1/2 origin-bottom" style={{ transform: `translateX(-50%) rotate(${i * 90}deg)` }}>
              <div className={`mt-5 font-bold text-lg ${c === 'N' ? 'text-red-500' : 'text-zinc-400'}`} style={{ transform: `rotate(${-i * 90 - dialRot}deg)` }}>{c}</div>
            </div>
          ))}
        </div>
        {/* Needle toward the target */}
        {target && (
          <div className="absolute inset-0" style={{ transform: `rotate(${needleRot}deg)`, transition: 'transform 120ms linear' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_12px_rgba(0,0,0,.8)]">
              <polygon points="50,9 60,50 50,44 40,50" fill={accent} />
              <polygon points="50,91 57,50 50,55 43,50" fill="#3f3f46" />
            </svg>
          </div>
        )}
        {/* Center readout */}
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="w-[34%] aspect-square rounded-full bg-zinc-950 border border-zinc-700 grid place-items-center text-center">
            {target ? (
              <div>
                <div className="text-xl font-bold leading-tight">{arrived ? 'Here!' : fmtMiles(dist)}</div>
                <div className="text-[11px] text-zinc-400">{cardinal(brg)} · {Math.round(brg)}°</div>
              </div>
            ) : <div className="text-xs text-zinc-500">No target</div>}
          </div>
        </div>
        {facing && !arrived && <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] font-semibold px-2 py-0.5 rounded-full text-black" style={{ background: accent }}>Straight ahead</div>}
      </div>

      {/* Sensor status */}
      <div className="text-xs text-center text-zinc-400 max-w-sm space-y-1">
        {state.status === 'needs-permission' && (
          <button onClick={requestPermission} className="rounded-lg px-4 py-2 font-semibold text-black" style={{ background: accent }}>Turn on compass</button>
        )}
        {state.status === 'waiting' && <p>Starting compass… hold your phone flat.</p>}
        {state.status === 'live' && <p>Hold your phone flat. Arrow points to the place. Heading {Math.round(heading)}° {cardinal(heading)}.</p>}
        {state.status === 'unavailable' && <p>{state.reason} Arrow is drawn with <b>north at the top</b>.</p>}
        <p>
          {fix.source === 'gps' ? `📍 Live location${fix.accuracy ? ` (±${Math.round(fix.accuracy * 3.28)} ft)` : ''}` : `🏠 ${locationError ?? 'Using your home ZIP.'}`}
          {fix.source !== 'gps' && onRetryLocation && <button onClick={onRetryLocation} className="underline ml-1">Try again</button>}
        </p>
      </div>

      {/* Target card */}
      {target && (
        <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-lg leading-tight">{target.name}</div>
              {target.headline && <div className="mt-1">{target.headline}</div>}
            </div>
            {position && <div className="text-xs text-zinc-500 shrink-0">{position}</div>}
          </div>
          {target.detail && <div className="text-sm text-zinc-400 space-y-0.5">{target.detail}</div>}
          <div className="flex gap-2 pt-1">
            {onPrev && <button onClick={onPrev} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm">‹ Prev</button>}
            <a href={directionsUrl(target.lat, target.lng, dist < 1 ? 'walking' : 'driving')} target="_blank" rel="noreferrer"
              className="flex-1 text-center rounded-lg px-3 py-2 text-sm font-semibold text-black" style={{ background: accent }}>Directions</a>
            {onNext && <button onClick={onNext} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm">Next ›</button>}
          </div>
        </div>
      )}
    </div>
  );
}
