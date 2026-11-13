import { useEffect, useState } from 'react';
import type { StoreOverride, UserProfile } from '@gib/shared';
import { api, type StoreRow } from '../api.ts';
import { haversine } from '../geo.ts';

type Tri = boolean | null;
const triLabel = (v: Tri) => (v === true ? 'Yes' : v === false ? 'No' : 'Unknown');

/** Pick Yes / No / Unknown, showing what was auto-detected. */
function TriSelect({ label, detected, value, onChange }: { label: string; detected: Tri; value: Tri | undefined; onChange: (v: Tri | undefined) => void }) {
  const current = value === undefined ? 'auto' : String(value);
  return (
    <label className="flex items-center justify-between gap-2 text-sm py-1">
      <span className="text-zinc-300">{label}</span>
      <select value={current} onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'auto' ? undefined : v === 'null' ? null : v === 'true');
      }} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs">
        <option value="auto">Auto ({triLabel(detected)})</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
        <option value="null">Unknown</option>
      </select>
    </label>
  );
}

export default function StoresPage({ profile, onProfile }: { profile: UserProfile; onProfile: (p: UserProfile) => void }) {
  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const load = () => api.stores().then(setRows);
  useEffect(() => { load(); }, []);

  const update = async (row: StoreRow, patch: Partial<StoreOverride>) => {
    const next: Partial<StoreOverride> = { ...(row.override ?? {}), ...patch };
    for (const k of Object.keys(patch) as (keyof StoreOverride)[]) if (patch[k] === undefined) delete next[k];
    await api.setOverride(row.store.id, next);
    load();
  };

  const list = (rows ?? [])
    .filter((r) => r.store.name.toLowerCase().includes(filter.toLowerCase()) || r.store.city.toLowerCase().includes(filter.toLowerCase()))
    .map((r) => ({ r, d: haversine(profile.lat, profile.lng, r.store.lat, r.store.lng) }))
    .sort((a, b) => a.d - b.d);

  return (
    <div className="p-4 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Stores</h2>
        <p className="text-xs text-zinc-400">Fix anything auto-detection got wrong. Your answers override what the menus say.</p>
      </div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or city" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
      {!rows && <p className="text-zinc-400">Loading…</p>}
      <ul className="space-y-3">
        {list.map(({ r, d }) => {
          const visited = profile.visitedStoreIds.includes(r.store.id);
          return (
            <li key={r.store.id} className={`rounded-2xl border border-zinc-800 bg-[#111c18] p-4 ${r.override?.hidden ? 'opacity-50' : ''}`}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{r.store.name}</h3>
                  <p className="text-xs text-zinc-400">{d.toFixed(1)} mi · {r.store.address}, {r.store.city}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">via {r.store.sources.map((s) => s.source).join(', ')}</p>
                </div>
                {r.store.menuUrl && <a href={r.store.menuUrl} target="_blank" rel="noreferrer" className="text-xs text-green-400 underline shrink-0">menu ↗</a>}
              </div>
              <div className="mt-2 divide-y divide-zinc-800/60">
                <TriSelect label="Prices include taxes" detected={r.detected.taxIncluded} value={r.override?.taxIncluded} onChange={(v) => update(r, { taxIncluded: v })} />
                <TriSelect label="Pickup on store's own site" detected={r.detected.ownSitePickup} value={r.override?.ownSitePickup} onChange={(v) => update(r, { ownSitePickup: v })} />
                <label className="flex items-center justify-between text-sm py-1">
                  <span className="text-zinc-300">I've been here</span>
                  <input type="checkbox" checked={visited} onChange={async (e) => onProfile(await api.setVisited(r.store.id, e.target.checked))} />
                </label>
                <label className="flex items-center justify-between text-sm py-1">
                  <span className="text-zinc-300">Hide this store</span>
                  <input type="checkbox" checked={!!r.override?.hidden} onChange={(e) => update(r, { hidden: e.target.checked || undefined })} />
                </label>
              </div>
              {r.store.delivery.length > 0 && (
                <p className="text-xs text-zinc-400 mt-2">
                  Delivery: {r.store.delivery.map((x) => `${x.via} $${x.fee.toFixed(2)}${x.minimum ? ` (min $${x.minimum})` : ''}`).join(' · ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
