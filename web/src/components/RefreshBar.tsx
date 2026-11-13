import { useEffect, useRef, useState } from 'react';
import type { RefreshStatus } from '@gib/shared';
import { api } from '../api.ts';

function ago(iso?: string) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : new Date(iso).toLocaleDateString();
}

const SOURCE_NAMES: Record<string, string> = { osm: 'Places (OpenStreetMap)', 'bar-websites': 'Bar websites', 'athens-menus': 'Athens bar menus (€)' };

/** Refresh button + "updated X ago" + per-source status (tap to see which sources failed). */
export default function RefreshBar({ onRefreshed, statusFn = api.status, refreshFn = api.refresh, accent = 'weed' }: {
  onRefreshed: () => void;
  accent?: 'weed' | 'beer';
  statusFn?: () => Promise<RefreshStatus>;
  refreshFn?: () => Promise<RefreshStatus>;
}) {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const wasRunning = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await statusFn();
        if (!alive) return;
        setStatus(s);
        if (wasRunning.current && !s.running) onRefreshed();
        wasRunning.current = s.running;
      } catch { /* server unreachable; App handles */ }
    };
    tick();
    const id = setInterval(tick, status?.running ? 2000 : 30000);
    return () => { alive = false; clearInterval(id); };
  }, [status?.running, onRefreshed, statusFn]);

  const failed = status?.sources.filter((s) => !s.ok) ?? [];

  return (
    <div className="relative flex items-center gap-2">
      <button onClick={() => setShowDetail(!showDetail)} className="text-xs text-zinc-400 text-right whitespace-nowrap" title="When prices were last updated">
        {status?.running ? 'Refreshing…' : <><span className="hidden sm:inline">Updated </span>{ago(status?.lastRefreshAt)}</>}
        {failed.length > 0 && <span className="text-amber-400"> · {failed.length} source{failed.length > 1 ? 's' : ''} failed</span>}
      </button>
      <button
        disabled={status?.running}
        onClick={async () => {
          const s = await refreshFn();
          if (s.throttled) {
            onRefreshed();
            setNote(`Prices are fresh (updated ${ago(s.lastRefreshAt)}). Next full re-check after ${new Date(s.nextAllowedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
            setTimeout(() => setNote(null), 5000);
            return;
          }
          wasRunning.current = true;
          setStatus(s);
        }}
        className={`rounded-full ${accent === 'beer' ? 'bg-amber-500' : 'bg-green-500'} text-black w-9 h-9 grid place-items-center font-bold disabled:opacity-60`}
        aria-label="Refresh prices"
      >
        <span className={status?.running ? 'animate-spin inline-block' : ''}>↻</span>
      </button>
      {note && <div className="absolute right-0 top-11 z-30 w-64 rounded-xl bg-zinc-900 border border-zinc-700 p-3 text-xs text-zinc-300 shadow-xl">{note}</div>}
      {showDetail && status && (
        <div className="absolute right-0 top-11 z-30 w-72 rounded-xl bg-zinc-900 border border-zinc-700 p-3 text-xs space-y-1 shadow-xl">
          <p className="text-zinc-300 font-medium mb-1">Sources</p>
          {status.sources.length === 0 && <p className="text-zinc-500">No refresh yet.</p>}
          {status.sources.map((s) => (
            <div key={s.source} className="flex justify-between gap-2">
              <span className="capitalize">{s.ok ? "✅" : "⚠️"} {SOURCE_NAMES[s.source] ?? s.source}</span>
              <span className="text-zinc-400 text-right">{s.ok ? `${s.stores} stores · ${s.products} items` : (s.error ?? 'failed').slice(0, 80)}</span>
            </div>
          ))}
          <p className="text-zinc-500 pt-1">Auto-refreshes every morning.</p>
        </div>
      )}
    </div>
  );
}
