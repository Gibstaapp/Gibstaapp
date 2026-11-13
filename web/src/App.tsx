import { useCallback, useEffect, useState } from 'react';
import { regionOf, type Region, type UserProfile } from '@gib/shared';
import { RegionContext } from './region.ts';
import { api, needsServerUrl, AuthError, STATIC } from './api.ts';
import PasscodeScreen from './pages/PasscodeScreen.tsx';
import Onboarding from './pages/Onboarding.tsx';
import DealsPage from './pages/DealsPage.tsx';
import StoresPage from './pages/StoresPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import ServerSetup from './pages/ServerSetup.tsx';
import BeerPage from './pages/BeerPage.tsx';
import BadgesPage from './pages/BadgesPage.tsx';
import { Logo } from './components/Place.tsx';

type AppMode = 'weed' | 'beer';

/** The Weed / Beer switch at the top of every screen. Where weed isn't legal, Weed is greyed out and explains why. */
function ModeSwitch({ mode, onChange, weedLegal, onWeedBlocked }: { mode: AppMode; onChange: (m: AppMode) => void; weedLegal: boolean; onWeedBlocked: () => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full bg-zinc-900 border border-zinc-700 p-0.5 text-sm font-semibold">
      {weedLegal
        ? <button onClick={() => onChange('weed')} className={`px-3 py-1 rounded-full ${mode === 'weed' ? 'bg-green-500 text-black' : 'text-zinc-400'}`}>🌿 Weed</button>
        : <button onClick={onWeedBlocked} aria-label="Weed (not available here)" className="px-3 py-1 rounded-full text-zinc-600 grayscale opacity-60">🌿 Weed</button>}
      <button onClick={() => onChange('beer')} className={`px-3 py-1 rounded-full ${mode === 'beer' ? 'bg-amber-500 text-black' : 'text-zinc-400'}`}>🍺 Beer</button>
    </div>
  );
}

/** Tapped the greyed-out Weed switch somewhere weed isn't legal. */
function NoWeedHere({ region, onClose }: { region: Region; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 grid place-items-center p-6" onClick={onClose} role="dialog" aria-label="Weed isn't available here">
      <div onClick={(e) => e.stopPropagation()} className="gib-pop w-full max-w-xs rounded-3xl border-2 border-zinc-700 bg-zinc-950 p-6 text-center space-y-3">
        <div className="text-6xl leading-none">😭</div>
        <h2 className="text-xl font-bold">No weed in {region.city}</h2>
        <p className="text-sm text-zinc-300">Recreational cannabis isn't legal in Greece, so our compass has nowhere to point. It's in the corner crying into its ouzo.</p>
        <p className="text-sm text-zinc-400">The beer, on the other hand, is extremely legal. Opa! 🍺</p>
        <button onClick={onClose} className="w-full rounded-xl py-2.5 font-semibold text-black bg-amber-500">Take me to the beer</button>
      </div>
    </div>
  );
}

// Both modes: Deals (list / map / compass, switched in the header) + Settings. Weed also has Stores.
type Tab = 'deals' | 'stores' | 'badges' | 'settings';

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<AppMode>(() => (localStorage.getItem('gib.app') as AppMode) || 'weed');
  const [tab, setTab] = useState<Tab>('deals');
  const setMode = (m: AppMode) => { localStorage.setItem('gib.app', m); setModeState(m); setTab('deals'); window.scrollTo(0, 0); };
  const [needServer, setNeedServer] = useState(needsServerUrl());
  const [needPass, setNeedPass] = useState(false);
  const [noWeed, setNoWeed] = useState(false);
  const region = regionOf(profile?.homeZip);

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
        <Logo size={48} />
        <h1 className="text-xl font-bold">{STATIC ? "Couldn't load today's deals" : "Can't reach the Gibstaapp server"}</h1>
        <p className="text-zinc-400 text-sm">{error}</p>
        <p className="text-zinc-400 text-sm">{STATIC ? 'Check your connection and try again.' : "Make sure the server is running on your PC and you're using its current link."}</p>
        <div className="flex gap-2">
          <button className="btn-primary px-4 py-2 rounded-lg bg-green-500 text-black font-semibold" onClick={loadProfile}>Retry</button>
          {!STATIC && <button className="px-4 py-2 rounded-lg bg-zinc-800" onClick={() => setNeedServer(true)}>Change server</button>}
        </div>
      </div>
    );
  }
  if (!profile) return <div className="p-6 text-zinc-400">Loading…</div>;
  if (!profile.onboarded) return <Onboarding profile={profile} onDone={setProfile} />;

  // Where weed isn't legal the app runs on the beer side (the saved choice comes back when you're home again).
  const side: AppMode = region.weedLegal ? mode : 'beer';
  const top = <div className="flex items-center gap-2"><Logo /><ModeSwitch mode={side} onChange={setMode} weedLegal={region.weedLegal} onWeedBlocked={() => setNoWeed(true)} /></div>;
  const plainTop = <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">{top}</div>;
  const navItems: readonly (readonly [Tab, string, string])[] = side === 'weed'
    ? [['deals', 'Deals', '🌿'], ['stores', 'Stores', '🏪'], ['badges', 'Badges', '🏅'], ['settings', 'Settings', '⚙️']]
    : [['deals', 'Deals', '🍺'], ['badges', 'Badges', '🏅'], ['settings', 'Settings', '⚙️']];
  const activeColor = side === 'weed' ? 'text-green-400' : 'text-amber-400';
  const shown: Tab = navItems.some(([id]) => id === tab) ? tab : 'deals';

  return (
    <RegionContext.Provider value={region}>
    <div className="min-h-full flex flex-col max-w-3xl mx-auto">
      <main className="flex-1 pb-20">
        {side === 'weed' && shown === 'deals' && <DealsPage profile={profile} onProfile={setProfile} top={top} />}
        {side === 'weed' && shown === 'stores' && <>{plainTop}<StoresPage profile={profile} onProfile={setProfile} /></>}
        {side === 'beer' && shown === 'deals' && <BeerPage profile={profile} top={top} />}
        {shown === 'badges' && <>{plainTop}<BadgesPage side={side} /></>}
        {shown === 'settings' && <>{plainTop}<SettingsPage accent={side} profile={profile} onProfile={setProfile} onChangeServer={() => setNeedServer(true)} /></>}
      </main>
      <nav className={`fixed bottom-0 inset-x-0 backdrop-blur border-t border-zinc-800 pb-[env(safe-area-inset-bottom)] ${side === 'weed' ? 'bg-[#0e1714]/95' : 'bg-[#17130b]/95'}`}>
        <div className={`max-w-3xl mx-auto grid ${navItems.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {navItems.map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`py-3 text-sm flex flex-col items-center gap-0.5 ${shown === id ? activeColor : 'text-zinc-400'}`}>
              <span className="text-lg leading-none">{icon}</span>{label}
            </button>
          ))}
        </div>
      </nav>
      {noWeed && <NoWeedHere region={region} onClose={() => { setNoWeed(false); setTab('deals'); }} />}
    </div>
    </RegionContext.Provider>
  );
}
