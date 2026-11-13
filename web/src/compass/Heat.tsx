import type { Accent } from '../components/Place.tsx';

/**
 * "Getting warmer" indicator inside the compass dial. It grows slowly as you get closer to the place:
 *  - weed: a burn mark spreading out from the middle, with a glowing ember edge;
 *  - beer: a glass seen from above filling up, the beer sloshing side to side.
 */

/** 0 = far away (15+ miles), 1 = you're there. Log scale, so the last mile still moves it. */
export function closeness(miles: number): number {
  const NEAR = 0.03, FAR = 15;
  if (!(miles > NEAR)) return 1;
  return Math.max(0, Math.min(1, 1 - Math.log(miles / NEAR) / Math.log(FAR / NEAR)));
}

const LABELS: Record<Accent, [string, string, string, string]> = {
  weed: ['Cold trail', 'Getting warmer', 'Smoking hot', "You're on fire. It's right here"],
  beer: ['Bone dry', 'Filling up', 'Nearly a full pour', 'Cheers, you made it'],
};
export function heatLabel(side: Accent, c: number): string {
  return LABELS[side][c >= 0.97 ? 3 : c >= 0.66 ? 2 : c >= 0.33 ? 1 : 0];
}

export default function Heat({ side, value }: { side: Accent; value: number }) {
  // Smallest: just peeking out from behind the center readout. Largest: almost out to the N/E/S/W letters.
  const scale = 0.5 + 0.5 * value;
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <defs>
        <radialGradient id="gib-burn">
          <stop offset="0%" stopColor="#0c0a09" />
          <stop offset="52%" stopColor="#1c1917" />
          <stop offset="68%" stopColor="#7c2d12" />
          <stop offset="82%" stopColor="#ea580c" />
          <stop offset="92%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <filter id="gib-rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" />
        </filter>
        <radialGradient id="gib-beer">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="70%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
        <clipPath id="gib-glass"><circle cx="50" cy="50" r="34" /></clipPath>
      </defs>
      <g className="gib-heat-grow" style={{ transform: `scale(${scale})` }}>
        {side === 'weed' ? (
          <g className="gib-burn-flicker">
            <g className="gib-burn-drift" filter="url(#gib-rough)">
              <circle cx="50" cy="50" r="34" fill="url(#gib-burn)" />
            </g>
          </g>
        ) : (
          <>
            <g clipPath="url(#gib-glass)">
              <g className="gib-slosh">
                <circle cx="50" cy="50" r="36" fill="url(#gib-beer)" />
                {/* foam: a thick ragged rim plus a few bubbles */}
                <circle cx="50" cy="50" r="33" fill="none" stroke="#fffbeb" strokeWidth="4.5" strokeDasharray="7 2 3 2 9 1.5 4 2.5" strokeLinecap="round" opacity="0.92" />
                <ellipse cx="38" cy="36" rx="9" ry="4" fill="#fff" opacity="0.22" transform="rotate(-35 38 36)" />
                {[[30, 58, 1.6], [66, 34, 1.3], [70, 62, 1.8], [44, 72, 1.2], [58, 26, 1]].map(([x, y, r], i) => (
                  <circle key={i} cx={x} cy={y} r={r} fill="#fffbeb" opacity="0.7" />
                ))}
              </g>
            </g>
            <circle cx="50" cy="50" r="34.6" fill="none" stroke="#e4e4e7" strokeOpacity="0.35" strokeWidth="1.2" />
          </>
        )}
      </g>
    </svg>
  );
}
