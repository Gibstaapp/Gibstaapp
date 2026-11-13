import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import WeedCompass from '../components/WeedCompass.tsx';
import { CATEGORIES, distanceChoices, fmtDistance, type Category, type Mode, type PricedItem, type UserProfile } from '@gib/shared';
import { api } from '../api.ts';
import DealCard from '../components/DealCard.tsx';
import RefreshBar from '../components/RefreshBar.tsx';
import MapView from '../components/MapView.tsx';
import { snapTo, useRegion } from '../region.ts';
import { ACCENT, Chips, EmptyState, MilesSelect, OpenNowToggle, Segmented, VIEWS, pref, type PlaceView } from '../components/Place.tsx';

const DISTANCES_MI = [5, 10, 15, 20, 30, 50], DISTANCES_KM = [5, 10, 20, 30, 50, 80];
const CATEGORY_CHIPS = CATEGORIES.map((c) => [c.id, c.label] as const);
const MODES = [['pickup', 'Pickup'], ['delivery', 'Delivery']] as const;

export default function DealsPage({ profile, onProfile, top }: { profile: UserProfile; onProfile: (p: UserProfile) => void; top?: ReactNode }) {
  const [category, setCategory] = useState<Category>(() => (pref.get('gib.cat') as Category) || 'flower');
  const [mode, setMode] = useState<Mode>(() => (pref.get('gib.mode') as Mode) || 'pickup');
  const region = useRegion();
  // Your city's own weed refresh (San Diego and New York update separately).
  const statusFn = useCallback(async () => {
    const s = await api.status();
    const sources = s.sources.filter((x) => (x.region ?? 'us') === region.id);
    return { ...s, sources, lastRefreshAt: sources.map((x) => x.finishedAt).sort().pop() ?? s.lastRefreshAt };
  }, [region.id]);
  const refreshFn = useCallback(() => api.refresh(region.id), [region.id]);
  const choices = distanceChoices(region.units, DISTANCES_MI, DISTANCES_KM);
  const [maxMiles, setMaxMiles] = useState(() => snapTo(profile.radiusMiles, choices));
  const [openNow, setOpenNow] = useState(() => pref.get('gib.open') !== '0');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<PlaceView>(() => (pref.get('gib.view') as PlaceView) || 'list');
  const [compassStore, setCompassStore] = useState<string | undefined>();
  const [items, setItems] = useState<PricedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onePerStore, setOnePerStore] = useState(false);

  useEffect(() => {
    pref.set('gib.cat', category); pref.set('gib.mode', mode); pref.set('gib.view', view); pref.set('gib.open', openNow ? '1' : '0');
  }, [category, mode, view, openNow]);

  const load = useCallback(() => {
    setError(null);
    api.items({ category, mode, maxMiles, search: search || undefined, openNow })
      .then(setItems)
      .catch((e) => setError(String(e.message ?? e)));
  }, [category, mode, maxMiles, search, openNow]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const shown = useMemo(() => {
    if (!items) return null;
    if (!onePerStore) return items;
    const seen = new Set<string>();
    return items.filter((i) => (seen.has(i.store.id) ? false : (seen.add(i.store.id), true)));
  }, [items, onePerStore]);
  const storeCount = useMemo(() => new Set(shown?.map((i) => i.store.id)).size, [shown]);

  const markVisited = async (storeId: string, visited: boolean) => {
    onProfile(await api.setVisited(storeId, visited));
    load();
  };
  const pointAt = (storeId: string) => { setCompassStore(storeId); setView('compass'); window.scrollTo(0, 0); };

  return (
    <div>
      <header className={`sticky top-0 z-20 ${ACCENT.weed.header} backdrop-blur border-b border-zinc-800 pt-[env(safe-area-inset-top)]`}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          {top ?? <h1 className="text-lg font-bold tracking-tight">Gibsta<span className="text-green-400">app</span></h1>}
          <RefreshBar onRefreshed={load} statusFn={statusFn} refreshFn={refreshFn} />
        </div>
        <Chips accent="weed" items={CATEGORY_CHIPS} value={category} onChange={setCategory} />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
          <Segmented items={MODES} value={mode} onChange={setMode} />
          {mode === 'pickup' && <MilesSelect value={maxMiles} choices={choices} onChange={setMaxMiles} />}
          <OpenNowToggle value={openNow} onChange={setOpenNow} />
          <label className="flex items-center gap-1 text-zinc-300">
            <input type="checkbox" checked={onePerStore} onChange={(e) => setOnePerStore(e.target.checked)} /> 1 per store
          </label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brand / strain"
            className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1" />
          <Segmented items={VIEWS} value={view} onChange={(v) => { setCompassStore(undefined); setView(v); }} />
        </div>
      </header>

      {error && <p className="m-4 p-3 rounded-lg bg-red-950 text-red-200 text-sm">{error}</p>}
      {!shown && !error && <p className="p-6 text-zinc-400">Loading deals…</p>}
      {shown && shown.length === 0 && (
        <EmptyState accent="weed" openNow={openNow} onShowClosed={() => setOpenNow(false)}>
          No {mode} results{openNow ? ' open right now' : ''} for this category{mode === 'pickup' ? ` within ${fmtDistance(maxMiles, region.units, 0)}` : ''}.
          {openNow ? ' The deals will still be there in the morning.' : ' Try a wider distance or another category.'}
        </EmptyState>
      )}

      {shown && shown.length > 0 && view === 'map' && <MapView items={shown} profile={profile} />}
      {shown && shown.length > 0 && view === 'compass' && <WeedCompass items={shown} profile={profile} startStoreId={compassStore} />}
      {shown && shown.length > 0 && view === 'list' && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-zinc-500 px-1">{shown.length} deals · {storeCount} {storeCount === 1 ? 'store' : 'stores'}{openNow ? ' open now' : ''} · from {region.codeName} {profile.homeZip}</p>
          <ul className="space-y-3">
            {shown.map((item, i) => (
              <li key={`${item.product.id}`}><DealCard item={item} rank={i + 1} onVisited={markVisited} onPointMe={() => pointAt(item.store.id)} /></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
