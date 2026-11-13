import { useRef, useState, type ReactNode } from 'react';
import { dayKey, fmtDistance, fmtNear, placeBadge, visitsToNext, type Badge } from '@gib/shared';
import { useRegion } from '../region.ts';
import { haversine } from '../geo.ts';
import { bearing, directionsUrl, shortestArc, useHeading, type Fix } from './sensors.ts';
import Heat, { closeness, heatLabel } from './Heat.tsx';
import { ACCENT, type Accent } from '../components/Place.tsx';
import { CHECKIN_MILES, useVisits } from '../badges.ts';
import BadgeParty from '../components/BadgeParty.tsx';

export interface CompassTarget {
  id: string;
  name: string;
  /** Name without the icon, for check-ins and badges. */
  placeName?: string;
  lat: number;
  lng: number;
  /** Big line under the name: price, deal… */
  headline?: ReactNode;
  /** Small lines: open status, address… */
  detail?: ReactNode;
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (d: number) => CARD[Math.round(d / 45) % 8];

/** Keeps a rotation continuous (no 359° -> 0° spin) by accumulating shortest-arc steps. */
function useUnwrapped(angle: number) {
  const acc = useRef<number | null>(null);
  if (acc.current == null) acc.current = angle;
  else acc.current += shortestArc(acc.current, angle);
  return acc.current;
}

export default function Compass({ fix, target, side, onPrev, onNext, position, locationError, onRetryLocation }: {
  fix: Fix;
  target: CompassTarget | null;
  side: Accent;           // weed = green + burn mark, beer = amber + sloshing glass
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;      // "2 of 40"
  locationError?: string | null;
  onRetryLocation?: () => void;
}) {
  const accent = ACCENT[side].hex;
  const region = useRegion();
  const { state, requestPermission } = useHeading();
  const { log, visit } = useVisits();
  const [party, setParty] = useState<Badge[]>([]);
  const heading = state.status === 'live' ? state.heading : 0;
  const brg = target ? bearing(fix.lat, fix.lng, target.lat, target.lng) : 0;
  const dist = target ? haversine(fix.lat, fix.lng, target.lat, target.lng) : 0;
  const dialRot = useUnwrapped(-heading);
  const needleRot = useUnwrapped(brg - heading);
  const arrived = target && fix.source === 'gps' && dist < 0.03;
  const facing = state.status === 'live' && Math.abs(shortestArc(heading, brg)) < 12;
  const warm = target ? closeness(dist) : 0;

  // Check-ins: one per place per day, and only when you're really there.
  const rec = target ? log[target.id] : undefined;
  const visits = rec?.days.length ?? 0;
  const doneToday = !!rec?.days.includes(dayKey());
  const near = fix.source === 'gps' && dist <= CHECKIN_MILES;
  const badge = placeBadge(rec);
  const next = visitsToNext(side, visits);
  const checkInHint = doneToday ? 'Checked in today. Come back tomorrow for the next one.'
    : fix.source !== 'gps' ? 'Turn on location to check in when you get there.'
      : near ? 'You made it! Tap to count this visit.' : `Get within ${fmtDistance(CHECKIN_MILES, region.units)} to check in.`;

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
        {/* Burn mark / beer glass: grows as you get closer */}
        {target && <Heat side={side} value={warm} />}
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
                <div className="text-xl font-bold leading-tight">{arrived ? 'Here!' : fmtNear(dist, region.units)}</div>
                <div className="text-[11px] text-zinc-400">{cardinal(brg)} · {Math.round(brg)}°</div>
              </div>
            ) : <div className="text-xs text-zinc-500">No target</div>}
          </div>
        </div>
        {facing && !arrived && <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] font-semibold px-2 py-0.5 rounded-full text-black" style={{ background: accent }}>Straight ahead</div>}
      </div>

      {target && (
        <div className="text-sm font-semibold -mb-1" style={{ color: accent }}>
          {side === 'weed' ? '🔥' : '🍺'} {heatLabel(side, warm)} <span className="text-zinc-500 font-normal">· {Math.round(warm * 100)}% there</span>
        </div>
      )}

      {/* Sensor status */}
      <div className="text-xs text-center text-zinc-400 max-w-sm space-y-1">
        {state.status === 'needs-permission' && (
          <button onClick={requestPermission} className="rounded-lg px-4 py-2 font-semibold text-black" style={{ background: accent }}>Turn on compass</button>
        )}
        {state.status === 'waiting' && <p>Starting compass… hold your phone flat.</p>}
        {state.status === 'live' && <p>Hold your phone flat. Arrow points to the place. Heading {Math.round(heading)}° {cardinal(heading)}.</p>}
        {state.status === 'unavailable' && <p>{state.reason} Arrow is drawn with <b>north at the top</b>.</p>}
        <p>
          {fix.source === 'gps' ? `📍 Live location${fix.accuracy ? ` (±${region.units === 'km' ? `${Math.round(fix.accuracy)} m` : `${Math.round(fix.accuracy * 3.28)} ft`})` : ''}` : `🏠 ${locationError ?? `Using your home ${region.codeName}.`}`}
          {fix.source !== 'gps' && onRetryLocation && <button onClick={onRetryLocation} className="underline ml-1">Try again</button>}
        </p>
      </div>

      {/* Target card */}
      {target && (
        <div className={`w-full max-w-md rounded-2xl border border-zinc-800 p-4 space-y-2 ${ACCENT[side].card}`}>
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
          {/* Check in + badge progress */}
          <div className="flex items-center gap-3 pt-2 mt-1 border-t border-zinc-800">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                {badge ? <span className="font-semibold" style={{ color: accent }}>{badge.emoji} {badge.title}</span> : <span className="text-zinc-300">🏅 Badge progress</span>}
                <span className="text-zinc-500 text-xs whitespace-nowrap">{visits} {visits === 1 ? 'visit' : 'visits'}{next ? ` · ${next.need} to ${next.tier.emoji}` : ''}</span>
              </div>
              {next && (
                <div className="flex gap-1 mt-1.5" aria-hidden="true">
                  {Array.from({ length: Math.min(next.tier.visits, 10) }, (_, i) => {
                    const filled = i < Math.round((visits / next.tier.visits) * Math.min(next.tier.visits, 10));
                    return <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: filled ? accent : '#3f3f46' }} />;
                  })}
                </div>
              )}
              <p className="text-[11px] text-zinc-500 mt-1">{checkInHint}</p>
            </div>
            <button disabled={!near || doneToday}
              onClick={() => setParty(visit({ id: target.id, name: target.placeName ?? target.name, side }))}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-black disabled:bg-zinc-800 disabled:text-zinc-500"
              style={!near || doneToday ? undefined : { background: accent }}>
              {doneToday ? '✔ Checked in' : '📍 Check in'}
            </button>
          </div>
        </div>
      )}
      {party.length > 0 && <BadgeParty badges={party} onClose={() => setParty([])} />}
    </div>
  );
}
