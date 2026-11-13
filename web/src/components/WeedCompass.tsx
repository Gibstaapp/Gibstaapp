import { useMemo, useState } from 'react';
import type { PricedItem, UserProfile } from '@gib/shared';
import Compass, { type CompassTarget } from '../compass/Compass.tsx';
import { useLocation } from '../compass/sensors.ts';

const $ = (n: number) => `$${n.toFixed(2)}`;

/** Compass pointing at the store with the best deal in the current list, one store at a time. */
export default function WeedCompass({ items, profile }: { items: PricedItem[]; profile: UserProfile }) {
  const home = useMemo(() => ({ lat: profile.lat, lng: profile.lng }), [profile.lat, profile.lng]);
  const { fix, error, retry } = useLocation(home);
  // Best item per store, in ranked order. Delivery-only stores have no place to walk to.
  const stops = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((i) => i.store.lat && i.store.lng && !seen.has(i.store.id) && (seen.add(i.store.id), true));
  }, [items]);
  const [idx, setIdx] = useState(0);
  const it = stops[Math.min(idx, stops.length - 1)];
  if (!it) return <p className="p-6 text-zinc-400 text-sm">No stores with a location in this list.</p>;
  const target: CompassTarget = {
    id: it.store.id,
    name: it.store.name,
    lat: it.store.lat,
    lng: it.store.lng,
    headline: (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold text-green-400">{$(it.perUnit)}<span className="text-sm font-normal">{it.unitLabel}</span></span>
        <span className="text-sm text-zinc-300">{it.product.name}</span>
      </div>
    ),
    detail: (<>
      <div>{$(it.otd)} out the door{it.deal ? ` · ${it.deal.title}` : ''}</div>
      {it.store.address && <div>{it.store.address}</div>}
    </>),
  };
  return (
    <Compass fix={fix} target={target} locationError={error} onRetryLocation={retry}
      position={`${idx + 1} of ${stops.length}`}
      onPrev={idx > 0 ? () => setIdx(idx - 1) : undefined}
      onNext={idx < stops.length - 1 ? () => setIdx(idx + 1) : undefined} />
  );
}
