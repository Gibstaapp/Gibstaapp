import { useEffect, useState } from 'react';
import type { UserProfile } from '@gib/shared';
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

/** ZIP, radius, and discount eligibility: shared by onboarding and settings. */
export default function ProfileForm({ value, onChange }: { value: UserProfile; onChange: (p: UserProfile) => void }) {
  const [zips, setZips] = useState<Record<string, { area: string }>>({});
  useEffect(() => { api.zips().then(setZips).catch(() => {}); }, []);
  const set = <K extends keyof UserProfile>(k: K, v: UserProfile[K]) => onChange({ ...value, [k]: v });

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 py-3 border-b border-zinc-800">
        <label className="text-sm">
          <span className="block text-zinc-400 mb-1">Home ZIP</span>
          <select value={value.homeZip} onChange={(e) => set('homeZip', e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2">
            {Object.entries(zips).sort().map(([z, info]) => <option key={z} value={z}>{z} · {info.area}</option>)}
            {!zips[value.homeZip] && <option value={value.homeZip}>{value.homeZip}</option>}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-zinc-400 mb-1">Search radius</span>
          <select value={value.radiusMiles} onChange={(e) => set('radiusMiles', Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2">
            {[5, 10, 15, 20, 30, 50].map((m) => <option key={m} value={m}>{m} miles{m === 30 ? ' (all of SD)' : ''}</option>)}
          </select>
        </label>
      </div>
      <Toggle label="I'm a veteran" hint="Most shops: 10–20% off with military ID" checked={value.veteran} onChange={(v) => set('veteran', v)} />
      <Toggle label="I'm a senior" hint="Usually 60+ or 65+ with ID" checked={value.senior} onChange={(v) => set('senior', v)} />
      <Toggle label="I'm a student" hint="Valid student ID required" checked={value.student} onChange={(v) => set('student', v)} />
    </div>
  );
}
