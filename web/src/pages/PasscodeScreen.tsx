import { useState } from 'react';
import { api, setPasscode } from '../api.ts';

export default function PasscodeScreen({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth(pass);
      setPasscode(pass);
      onDone();
    } catch (err: any) {
      setError(err.message === 'passcode required' ? 'Wrong passcode' : err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-sm mx-auto p-6 space-y-4 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <h1 className="text-2xl font-bold">Gibsta<span className="text-green-400">app</span></h1>
      <p className="text-sm text-zinc-400">Enter the passcode to see today's deals.</p>
      <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" autoFocus autoCapitalize="off" autoCorrect="off"
        placeholder="Passcode" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-3 text-lg" />
      <button disabled={busy || !pass} className="w-full rounded-xl bg-green-500 text-black font-semibold py-3 disabled:opacity-50">
        {busy ? 'Checking…' : 'Enter'}
      </button>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
