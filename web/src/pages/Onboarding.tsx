import { useState } from 'react';
import type { UserProfile } from '@gib/shared';
import { api } from '../api.ts';
import ProfileForm from '../components/ProfileForm.tsx';
import { Logo } from '../components/Place.tsx';

export default function Onboarding({ profile, onDone }: { profile: UserProfile; onDone: (p: UserProfile) => void }) {
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onDone(await api.saveProfile({ ...draft, onboarded: true }));
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      <div>
        <Logo size={64} />
        <h1 className="text-2xl font-bold mt-3">Welcome to <span className="text-green-400">Gibsta</span><span className="text-amber-400">app</span></h1>
        <p className="text-zinc-400 mt-2 text-sm">
          A compass that points at the cheapest weed and beer near you, with today's deals, taxes, and delivery fees counted in.
          A few questions so prices match what <em>you</em> would actually pay:
        </p>
      </div>
      <ProfileForm value={draft} onChange={setDraft} />
      <div className="rounded-xl bg-amber-500/10 border border-amber-700/60 p-3 text-sm text-amber-100">
        <p className="font-medium">About first-time deals</p>
        <p className="text-amber-100/80 mt-1">
          Many shops give 20–50% off your first order. We'll show those prices by default. On any store you've already
          been to, tap <strong>"I've been here"</strong> and prices update. You can edit your visited stores later in Settings.
        </p>
      </div>
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <button onClick={save} disabled={saving} className="w-full rounded-xl bg-green-500 text-black font-semibold py-3 disabled:opacity-60">
        {saving ? 'Saving…' : 'Show me the deals'}
      </button>
    </div>
  );
}
