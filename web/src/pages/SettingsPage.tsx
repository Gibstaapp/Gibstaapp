import { useEffect, useState } from 'react';
import type { UserProfile } from '@gib/shared';
import { api, serverUrl, STATIC, type StoreRow } from '../api.ts';
import ProfileForm from '../components/ProfileForm.tsx';

const randomTopic = () => `gibstaapp-${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 14)}`;

export default function SettingsPage({ profile, onProfile, onChangeServer, accent = 'weed' }: { accent?: 'weed' | 'beer'; profile: UserProfile; onProfile: (p: UserProfile) => void; onChangeServer: () => void }) {
  const [draft, setDraft] = useState(profile);
  const [msg, setMsg] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  useEffect(() => { api.publicUrl().then((r) => setPublicUrl(r.url)).catch(() => {}); }, []);
  useEffect(() => { api.stores().then(setStores).catch(() => {}); }, []);
  useEffect(() => setDraft(profile), [profile]);

  const btn = accent === 'beer' ? 'bg-amber-500' : 'bg-green-500';
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const save = async (p = draft) => {
    try {
      const saved = await api.saveProfile(p);
      onProfile(saved);
      setMsg('Saved');
    } catch (e: any) { setMsg(e.message); }
    setTimeout(() => setMsg(null), 2500);
  };

  const visited = stores.filter((r) => profile.visitedStoreIds.includes(r.store.id));
  const downloadUrl = `${serverUrl() || location.origin}/download`;

  return (
    <div className="p-4 space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-1">You</h2>
        <ProfileForm value={draft} onChange={setDraft} />
        <div className="flex items-center gap-3 mt-3">
          <button disabled={!dirty} onClick={() => save()} className={`rounded-lg ${btn} text-black font-semibold px-4 py-2 disabled:opacity-40`}>Save</button>
          {msg && <span className="text-sm text-zinc-400">{msg}</span>}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">Stores I've been to</h2>
        <p className="text-xs text-zinc-400 mb-2">First-time deals are hidden for these. Remove a store to see its first-timer price again.</p>
        {visited.length === 0 && <p className="text-sm text-zinc-500">None yet. Tap "I've been here" on a deal card.</p>}
        <ul className="space-y-1">
          {visited.map((r) => (
            <li key={r.store.id} className="flex justify-between items-center bg-zinc-900 rounded-lg px-3 py-2 text-sm">
              {r.store.name}
              <button onClick={async () => onProfile(await api.setVisited(r.store.id, false))} className="text-zinc-400 text-xs underline">remove</button>
            </li>
          ))}
        </ul>
      </section>

      {!STATIC && <section>
        <h2 className="text-lg font-semibold mb-1">Morning update</h2>
        <label className="text-sm block py-2">
          <span className="text-zinc-400">Refresh + notify at</span>{' '}
          <select value={draft.notifyHour} onChange={(e) => setDraft({ ...draft, notifyHour: Number(e.target.value) })} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 ml-2">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{((h + 11) % 12) + 1}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select>
        </label>
        <div className="text-sm space-y-2">
          <p className="text-zinc-400 text-xs">
            Push notifications use the free <strong>ntfy</strong> app (Play Store). Install it, tap +, and subscribe to the topic below.
            Anyone who knows the topic name can read it, so keep it random.
          </p>
          <div className="flex gap-2">
            <input value={draft.ntfyTopic ?? ''} onChange={(e) => setDraft({ ...draft, ntfyTopic: e.target.value.trim() || undefined })}
              placeholder="ntfy topic" className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 font-mono text-xs" />
            <button onClick={() => setDraft({ ...draft, ntfyTopic: randomTopic() })} className="rounded-lg bg-zinc-800 px-3 text-xs">Generate</button>
          </div>
          <button onClick={async () => {
            if (dirty) await save();
            const r = await api.testNotify();
            setMsg(r.sent ? 'Test notification sent' : `Not sent: ${r.reason}`);
            setTimeout(() => setMsg(null), 4000);
          }} className="rounded-lg bg-zinc-800 px-3 py-2 text-xs">Send test notification</button>
        </div>
      </section>}

      <section>
        <h2 className="text-lg font-semibold mb-1">Share with friends</h2>
        {publicUrl ? (
          <>
            <p className="text-sm text-zinc-400">Works on any phone, on Wi-Fi or data.{STATIC ? '' : " They'll need the passcode."}</p>
            <div className="flex gap-2 mt-2">
              <input readOnly value={publicUrl} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 font-mono text-xs" />
              <button onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => { setMsg('Link copied'); setTimeout(() => setMsg(null), 2000); })} className={`rounded-lg ${btn} text-black font-semibold px-3 text-xs`}>Copy</button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">{STATIC ? 'This link is permanent. Prices refresh every morning.' : 'This link changes if the PC restarts. With an ntfy topic set, the new link gets pushed to you.'}</p>
          </>
        ) : <p className="text-sm text-zinc-500">Public link is starting up (or turned off).</p>}
      </section>

      {!STATIC && <section>
        <h2 className="text-lg font-semibold mb-1">Android app</h2>
        <p className="text-sm text-zinc-400">Download the APK on your phone: <a className="text-green-400 underline break-all" href={downloadUrl}>{downloadUrl}</a></p>
        <p className="text-sm text-zinc-400 mt-2">Server: <span className="font-mono text-xs">{serverUrl() || location.origin}</span></p>
        <button onClick={onChangeServer} className="mt-2 rounded-lg bg-zinc-800 px-3 py-2 text-xs">Change server address</button>
      </section>}
    </div>
  );
}
