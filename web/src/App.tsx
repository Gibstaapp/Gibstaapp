import { useCallback, useEffect, useState } from 'react';
import type { UserProfile } from '@gib/shared';
import { api, needsServerUrl, AuthError } from './api.ts';
import PasscodeScreen from './pages/PasscodeScreen.tsx';
import Onboarding from './pages/Onboarding.tsx';
import DealsPage from './pages/DealsPage.tsx';
import StoresPage from './pages/StoresPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import ServerSetup from './pages/ServerSetup.tsx';
import BeerPage from './pages/BeerPage.tsx';

type AppMode = 'weed' | 'beer';

/** The Weed / Beer switch at the top of every screen. */
function ModeSwitch({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  return (
    <div className="flex rounded-full bg-zinc-900 border border-zinc-700 p-0.5 text-sm font-semibold">
      <button onClick={() => onChange('weed')} className={`px-3 py-1 rounded-full ${mode === 'weed' ? 'bg-green-500 text-black' : 'text-zinc-400'}`}>🌿 Weed</button>
      <button onClick={() => onChange('beer')} className={`px-3 py-1 rounded-full ${mode === 'beer' ? 'bg-amber-500 text-black' : 'text-zinc-400'}`}>🍺 Beer</button>
    </div>
  );
}

// Both modes: Deals (list / map / compass, switched in the header) + Settings. Weed also has Stores.
type Tab = 'deals' | 'stores' | 'settings';

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<AppMode>(() => (localStorage.getItem('gib.app') as AppMode) || 'weed');
  const [tab, setTab] = useState<Tab>('deals');
  const setMode = (m: AppMode) => { localStorage.setItem('gib.app', m); setModeState(m); setTab('deals'); window.scrollTo(0, 0); };
  const [needServer, setNeedServer] = useState(needsServerUrl());
  const [needPass, setNeedPass] = useState(false);

  const loadProfile = useCallback(() => {
    setError(null);
    api.profile().then(setProfile).catch((e) => (e instanceof AuthError ? setNeedPass(true) : setError(String(e.message ?? e))));
  }, []);

  useEffect(() => { if (!needServer) loadProfile(); }, [needServer, loadProfile]);

  if (needServer) return <ServerSetup onDone={() => setNeedServer(false)} />;
  if (needPass) return <PasscodeScreen onDone={() => { setNeedPass(false); loadProfile(); }} />;
  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-bold">Can't reach the Gibstaapp server</h1>
        <p className="text-zinc-400 text-sm">{error}</p>
        <p className="text-zinc-400 text-sm">Make sure the server is running on your PC (and Tailscale is connected if you're away from home).</p>
        <div className="flex gap-2">
          <button className="btn-primary px-4 py-2 rounded-lg bg-green-500 text-black font-semibold" onClick={loadProfile}>Retry</button>
          <button className="px-4 py-2 rounded-lg bg-zinc-800" onClick={() => setNeedServer(true)}>Change server</button>
        </div>
      </div>
    );
  }
  if (!profile) return <div className="p-6 text-zinc-400">Loading…</div>;
  if (!profile.onboarded) return <Onboarding profile={profile} onDone={setProfile} />;

  const top = <ModeSwitch mode={mode} onChange={setMode} />;
  const plainTop = <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">{top}</div>;
  const navItems: readonly (readonly [Tab, string, string])[] = mode === 'weed'
    ? [['deals', 'Deals', '🌿'], ['stores', 'Stores', '🏪'], ['settings', 'Settings', '⚙️']]
    : [['deals', 'Deals', '🍺'], ['settings', 'Settings', '⚙️']];
  const activeColor = mode === 'weed' ? 'text-green-400' : 'text-amber-400';

  return (
    <div className="min-h-full flex flex-col max-w-3xl mx-auto">
      <main className="flex-1 pb-20">
        {mode === 'weed' && tab === 'deals' && <DealsPage profile={profile} onProfile={setProfile} top={top} />}
        {mode === 'weed' && tab === 'stores' && <>{plainTop}<StoresPage profile={profile} onProfile={setProfile} /></>}
        {mode === 'beer' && tab === 'deals' && <BeerPage profile={profile} top={top} />}
        {tab === 'settings' && <>{plainTop}<SettingsPage profile={profile} onProfile={setProfile} onChangeServer={() => setNeedServer(true)} /></>}
      </main>
      <nav className={`fixed bottom-0 inset-x-0 backdrop-blur border-t border-zinc-800 pb-[env(safe-area-inset-bottom)] ${mode === 'weed' ? 'bg-[#0e1714]/95' : 'bg-[#17130b]/95'}`}>
        <div className={`max-w-3xl mx-auto grid ${navItems.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {navItems.map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`py-3 text-sm flex flex-col items-center gap-0.5 ${tab === id ? activeColor : 'text-zinc-400'}`}>
              <span className="text-lg leading-none">{icon}</span>{label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
