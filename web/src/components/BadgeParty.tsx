import type { Badge } from '@gib/shared';
import { ACCENT } from './Place.tsx';

const CONFETTI = { weed: ['🌿', '🔥', '✨', '🍃', '🏅'], beer: ['🍺', '🍻', '✨', '🫧', '🏅'] } as const;

/** Full-screen "you earned a badge!" moment. Tap anywhere to close. */
export default function BadgeParty({ badges, onClose }: { badges: Badge[]; onClose: () => void }) {
  const side = badges[0].side;
  return (
    <div className="fixed inset-0 z-50 bg-black/75 grid place-items-center p-6 overflow-hidden" onClick={onClose} role="dialog" aria-label="New badge">
      {Array.from({ length: 18 }, (_, i) => (
        <span key={i} className="gib-confetti" aria-hidden="true"
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.35}s`, animationDuration: `${2 + (i % 4) * 0.5}s` }}>
          {CONFETTI[side][i % CONFETTI[side].length]}
        </span>
      ))}
      <div className={`gib-pop relative w-full max-w-xs rounded-3xl border-2 p-6 text-center space-y-4 ${ACCENT[side].card}`} style={{ borderColor: ACCENT[side].hex }}>
        <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: ACCENT[side].hex }}>New badge!</p>
        {badges.map((b) => (
          <div key={b.key}>
            <div className="text-6xl leading-none">{b.emoji}</div>
            <h2 className="text-2xl font-bold mt-2">{b.title}</h2>
            {b.place && <p className="text-sm text-zinc-300">at {b.place}</p>}
            <p className="text-sm text-zinc-400 mt-1">{b.blurb}</p>
          </div>
        ))}
        <button onClick={onClose} className="w-full rounded-xl py-2.5 font-semibold text-black" style={{ background: ACCENT[side].hex }}>Nice</button>
      </div>
    </div>
  );
}
