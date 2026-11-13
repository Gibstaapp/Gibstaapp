import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import WeedCompass from '../components/WeedCompass.tsx';
import { CATEGORIES, type Category, type Mode, type PricedItem, type UserProfile } from '@gib/shared';
import { api } from '../api.ts';
import DealCard from '../components/DealCard.tsx';
import RefreshBar from '../components/RefreshBar.tsx';
import MapView from '../components/MapView.tsx';

const DISTANCES = [5, 10, 15, 20, 30, 50];

export default function DealsPage({ profile, onProfile, top }: { profile: UserProfile; onProfile: (p: UserProfile) => void; top?: ReactNode }) {
  const [category, setCategory] = useState<Category>(() => (localStorage.getItem('gib.cat') as Category) || 'flower');
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('gib.mode') as Mode) || 'pickup');
  const [maxMiles, setMaxMiles] = useState(profile.radiusMiles);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'map' | 'compass'>(() => (localStorage.getItem('gib.view') as 'list') || 'list');
  useEffect(() => { localStorage.setItem('gib.view', view); }, [view]);
  const [items, setItems] = useState<PricedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onePerStore, setOnePerStore] = useState(false);

  useEffect(() => { localStorage.setItem('gib.cat', category); localStorage.setItem('gib.mode', mode); }, [category, mode]);

  const load = useCallback(() => {
    setError(null);
    api.items({ category, mode, maxMiles, search: search || undefined })
      .then(setItems)
      .catch((e) => setError(String(e.message ?? e)));
  }, [category, mode, maxMiles, search]);

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

  const markVisited = async (storeId: string, visited: boolean) => {
    onProfile(await api.setVisited(storeId, visited));
    load();
  };

  return (
    <div>
      <header className="sticky top-0 z-20 bg-[#0b1210]/95 backdrop-blur border-b border-zinc-800 pt-[env(safe-area-inset-top)]">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          {top ?? <h1 className="text-lg font-bold tracking-tight">Gibsta<span className="text-green-400">app</span></h1>}
          <RefreshBar onRefreshed={load} />
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${category === c.id ? 'bg-green-500 text-black border-green-500 font-semibold' : 'border-zinc-700 text-zinc-300'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {(['pickup', 'delivery'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 capitalize ${mode === m ? 'bg-zinc-200 text-black' : 'text-zinc-300'}`}>{m}</button>
            ))}
          </div>
          {mode === 'pickup' && (
            <select value={maxMiles} onChange={(e) => setMaxMiles(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1">
              {DISTANCES.map((d) => <option key={d} value={d}>≤ {d} mi</option>)}
            </select>
          )}
          <label className="flex items-center gap-1 text-zinc-300">
            <input type="checkbox" checked={onePerStore} onChange={(e) => setOnePerStore(e.target.checked)} /> 1 per store
          </label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brand / strain"
            className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1" />
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {(['list', 'map', 'compass'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 capitalize ${view === v ? 'bg-zinc-200 text-black' : 'text-zinc-300'}`}>{v}</button>
            ))}
          </div>
        </div>
      </header>

      {error && <p className="m-4 p-3 rounded-lg bg-red-950 text-red-200 text-sm">{error}</p>}
      {!shown && !error && <p className="p-6 text-zinc-400">Loading deals…</p>}
      {shown && shown.length === 0 && (
        <p className="p-6 text-zinc-400">No {mode} results for this category{mode === 'pickup' ? ` within ${maxMiles} mi` : ''}. Try a wider distance or hit refresh.</p>
      )}

      {shown && shown.length > 0 && view === 'map' && <MapView items={shown} profile={profile} />}
      {shown && shown.length > 0 && view === 'compass' && <WeedCompass items={shown} profile={profile} />}
      {shown && shown.length > 0 && view === 'list' && (
        <ul className="p-3 space-y-3">
          {shown.map((item, i) => (
            <li key={`${item.product.id}`}><DealCard item={item} rank={i + 1} onVisited={markVisited} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
