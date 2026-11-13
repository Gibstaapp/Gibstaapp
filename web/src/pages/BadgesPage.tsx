import { fmtDistance, BADGE_TIERS, EXPLORER_TIERS, FIRST_BADGE_VISITS, earnedBadges, placeBadge, visitsToNext, type BadgeSide } from '@gib/shared';
import { CHECKIN_MILES, useVisits } from '../badges.ts';
import { ACCENT } from '../components/Place.tsx';
import { useRegion } from '../region.ts';

const SIDE_TITLE: Record<BadgeSide, string> = { weed: '🌿 Weed', beer: '🍺 Beer' };

/** Trophy shelf: badges earned, places in progress, and what there is to win. */
export default function BadgesPage({ side }: { side: BadgeSide }) {
  const { log } = useVisits();
  const { units } = useRegion();
  const earned = earnedBadges(log);
  const order: BadgeSide[] = side === 'weed' ? ['weed', 'beer'] : ['beer', 'weed'];

  return (
    <div className="p-4 space-y-8">
      <section>
        <h2 className="text-lg font-semibold">Your badges</h2>
        <p className="text-xs text-zinc-400 mt-1">
          Check in on the compass when you're within {fmtDistance(CHECKIN_MILES, units)} of a place. One check-in per place per day.
          Go back {FIRST_BADGE_VISITS} times and the first badge is yours.
        </p>
        {earned.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 p-6 text-center">
            <div className="text-4xl">🏅</div>
            <p className="text-sm text-zinc-300 mt-2">No badges yet.</p>
            <p className="text-xs text-zinc-500">Your shelf is embarrassingly empty. Go follow the compass.</p>
          </div>
        )}
        <ul className="grid grid-cols-2 gap-3 mt-4">
          {earned.map((b) => (
            <li key={b.key} className={`rounded-2xl border p-3 text-center ${ACCENT[b.side].card}`} style={{ borderColor: ACCENT[b.side].hex }}>
              <div className="text-4xl leading-none">{b.emoji}</div>
              <div className="font-semibold mt-1.5">{b.title}</div>
              <div className="text-xs text-zinc-300 truncate">{b.place ?? `${b.count} different places`}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{b.place ? `${b.count} visits` : b.blurb}</div>
            </li>
          ))}
        </ul>
      </section>

      {order.map((s) => {
        const places = Object.values(log).filter((r) => r.side === s).sort((a, b) => b.days.length - a.days.length);
        return (
          <section key={s}>
            <h2 className={`text-lg font-semibold ${ACCENT[s].text}`}>{SIDE_TITLE[s]}</h2>
            {places.length === 0 && <p className="text-sm text-zinc-500 mt-1">No check-ins yet.</p>}
            <ul className="space-y-2 mt-2">
              {places.map((r) => {
                const badge = placeBadge(r), next = visitsToNext(s, r.days.length);
                const pct = next ? Math.round((r.days.length / next.tier.visits) * 100) : 100;
                return (
                  <li key={r.id} className={`rounded-xl border border-zinc-800 p-3 ${ACCENT[s].card}`}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{badge ? `${badge.emoji} ` : ''}{r.name}</span>
                      <span className="text-zinc-400 shrink-0">{r.days.length} {r.days.length === 1 ? 'visit' : 'visits'}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 mt-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT[s].hex }} />
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">{next ? `${next.need} more for ${next.tier.emoji} ${next.tier.title}` : 'Top badge earned. Legend.'}</p>
                  </li>
                );
              })}
            </ul>
            <ul className="flex flex-wrap gap-1.5 mt-3">
              {[...BADGE_TIERS[s], ...EXPLORER_TIERS[s]].map((t, i) => (
                <li key={t.title} className="text-[11px] rounded-full border border-zinc-700 px-2 py-1 text-zinc-300">
                  {t.emoji} {t.title} <span className="text-zinc-500">· {t.visits} {i < BADGE_TIERS[s].length ? 'visits' : 'places'}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-[11px] text-zinc-500">Badges are saved on this phone only.</p>
    </div>
  );
}
