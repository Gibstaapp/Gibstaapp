import { useState } from 'react';
import { serverUrl, setServerUrl } from '../api.ts';

/** Android app: point it at the PC running the server (Tailscale address works from anywhere). */
export default function ServerSetup({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState(serverUrl() || 'http://');
  const [status, setStatus] = useState<string | null>(null);

  const test = async () => {
    setStatus('Checking…');
    try {
      const clean = url.trim().replace(/\/+$/, '');
      const res = await fetch(`${clean}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setServerUrl(clean);
      onDone();
    } catch (e: any) {
      setStatus(`Couldn't connect: ${e.message ?? e}`);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <h1 className="text-2xl font-bold">Connect to your PC</h1>
      <p className="text-sm text-zinc-400">
        Enter the address of the Gibstaapp server on your PC. With Tailscale it looks like
        <span className="font-mono"> http://100.x.y.z:8787</span> or <span className="font-mono">http://your-pc-name:8787</span>.
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off"
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-3 font-mono text-sm" />
      <button onClick={test} className="w-full rounded-xl bg-green-500 text-black font-semibold py-3">Connect</button>
      {status && <p className="text-sm text-zinc-300">{status}</p>}
    </div>
  );
}
