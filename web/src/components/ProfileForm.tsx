import { useEffect, useState } from 'react';
import { AREAS, KM_PER_MI, REGIONS, REGION_ORDER, regionOf, type HomeArea, type RegionId, type UserProfile } from '@gib/shared';
import { api } from '../api.ts';

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800 cursor-pointer">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
      </span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full relative transition shrink-0 ${checked ? 'bg-green-500' : 'bg-zinc-700'}`} aria-pressed={checked}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  );
}

const RADIUS_MI = [5, 10, 15, 20, 30, 50], RADIUS_KM = [5, 10, 20, 30, 50, 80];

/** Area code (U.S. / Europe tabs), radius, and discount eligibility: shared by onboarding and settings. */
export default function ProfileForm({ value, onChange }: { value: UserProfile; onChange: (p: UserProfile) => void }) {
  const [areas, setAreas] = useState<Record<string, HomeArea>>(AREAS);
  useEffect(() => { api.zips().then((a) => { if (a && Object.keys(a).length) setAreas(a); }).catch(() => {}); }, []);
  const set = <K extends keyof UserProfile>(k: K, v: UserProfile[K]) => onChange({ ...value, [k]: v });
  const [tab, setTab] = useState<RegionId>(() => regionOf(value.homeZip).id);
  const region = REGIONS[tab];

  // Codes in this tab, grouped: San Diego County; New York by borough; Athens by municipality.
  const groups = new Map<string, [string, HomeArea][]>();
  for (const [code, a] of Object.entries(areas).filter(([, a]) => (a.region ?? 'us') === tab).sort(([x], [y]) => x.localeCompare(y))) {
    const g = tab === 'us' ? 'San Diego County' : a.city;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push([code, a]);
  }
  const FIRST = ['Athens', 'Manhattan'];
  const groupNames = [...groups.keys()].sort((a, b) => (FIRST.includes(a) ? -1 : FIRST.includes(b) ? 1 : a.localeCompare(b)));
  const inTab = (areas[value.homeZip]?.region ?? 'us') === tab;
  const pickTab = (t: RegionId) => {
    setTab(t);
    // Switching tabs picks that region's first code, so home and units always match what you see.
    if ((areas[value.homeZip]?.region ?? 'us') !== t) {
      const first = Object.entries(areas).filter(([, a]) => (a.region ?? 'us') === t).sort(([x], [y]) => x.localeCompare(y))[0];
      if (first) onChange({ ...value, homeZip: first[0], lat: first[1].lat, lng: first[1].lng });
    }
  };
  const radius = (REGIONS[tab].units === 'km' ? RADIUS_KM.map((k) => [k / KM_PER_MI, `${k} km`] as const) : RADIUS_MI.map((m) => [m, `${m} miles${tab === 'us' && m === 30 ? ' (all of SD)' : tab === 'nyc' && m === 20 ? ' (all of NYC)' : ''}`] as const));
  const radiusValue = radius.reduce((best, [m]) => (Math.abs(m - value.radiusMiles) < Math.abs(best - value.radiusMiles) ? m : best), radius[0][0]);

  return (
    <div>
      <div className="py-3 border-b border-zinc-800">
        <div className="mb-3 text-sm">
          <span className="block text-zinc-400 mb-1">Area code</span>
          <div className="grid grid-cols-3 rounded-lg overflow-hidden border border-zinc-700" role="tablist">
            {REGION_ORDER.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => pickTab(t)}
                className={`px-1 py-1.5 whitespace-nowrap ${tab === t ? 'bg-zinc-200 text-black font-semibold' : 'text-zinc-300'}`}>{REGIONS[t].tab}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-zinc-400 mb-1">Home {region.codeName}</span>
            <select value={inTab ? value.homeZip : ''}
              onChange={(e) => { const a = areas[e.target.value]; onChange({ ...value, homeZip: e.target.value, ...(a ? { lat: a.lat, lng: a.lng } : {}) }); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2">
              {!inTab && <option value="" disabled>Pick a {region.city} {region.codeName}</option>}
              {groupNames.map((g) => (
                <optgroup key={g} label={g}>
                  {groups.get(g)!.map(([code, a]) => <option key={code} value={code}>{code} · {a.area}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-zinc-400 mb-1">Search radius</span>
            <select value={radiusValue} onChange={(e) => set('radiusMiles', Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2">
              {radius.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <Toggle label="I'm a veteran" hint="Most shops: 10–20% off with military ID" checked={value.veteran} onChange={(v) => set('veteran', v)} />
      <Toggle label="I'm a senior" hint="Usually 60+ or 65+ with ID" checked={value.senior} onChange={(v) => set('senior', v)} />
      <Toggle label="I'm a student" hint="Valid student ID required" checked={value.student} onChange={(v) => set('student', v)} />
    </div>
  );
}
