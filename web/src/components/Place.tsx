import type { ReactNode } from 'react';
import type { OpenStatus } from '@gib/shared';

/**
 * Pieces shared by the weed and beer screens so both look the same:
 * card shell, header row (name, distance, hours, big price), open/closing-soon line and filter controls.
 * Only the accent color differs: green for weed, amber for beer.
 */
export type Accent = 'weed' | 'beer';

export const ACCENT = {
  weed: { text: 'text-green-400', chip: 'bg-green-500 text-black border-green-500', card: 'bg-[#111c18]', header: 'bg-[#0b1210]/95', hex: '#22c55e' },
  beer: { text: 'text-amber-400', chip: 'bg-amber-500 text-black border-amber-500', card: 'bg-[#1a150c]', header: 'bg-[#14110b]/95', hex: '#f59e0b' },
} as const;

export const cardClass = (accent: Accent) => `rounded-2xl p-4 space-y-3 border border-zinc-800 ${ACCENT[accent].card}`;

/** Plain-text version (map popups). */
export function openText(s: OpenStatus): string {
  if (s.isOpen === null) return 'Hours not listed';
  return s.label ?? (s.isOpen ? 'Open now' : 'Closed');
}

/** Open / closing soon / closed / unknown. */
export function OpenBadge({ s }: { s: OpenStatus }) {
  if (s.isOpen === null) return <span className="text-zinc-500">Hours not listed</span>;
  if (s.closingSoon) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-orange-500 text-black font-semibold px-1.5 py-px text-[11px]">Closing soon</span>
        <span className="text-orange-300">{s.label}</span>
      </span>
    );
  }
  if (s.isOpen) return <span className="text-green-400">● {s.label ?? 'Open now'}</span>;
  return <span className="text-red-400">{s.label ?? 'Closed'}</span>;
}

/** Top of every place card: #rank name / distance · address / hours, and the big price on the right. */
export function PlaceHeader({ accent, rank, icon, name, distanceMiles, address, open, price, unit, priceNote }: {
  accent: Accent;
  rank: number;
  icon?: string;
  name: string;
  distanceMiles?: number;
  address?: string;
  open: OpenStatus;
  price?: string;
  unit?: string;
  priceNote?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">#{rank}</span>
          <h3 className="font-semibold truncate">{icon ? `${icon} ` : ''}{name}</h3>
        </div>
        <p className="text-xs text-zinc-400 truncate">
          {[distanceMiles != null ? `${distanceMiles.toFixed(1)} mi` : '', address].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs"><OpenBadge s={open} /></p>
      </div>
      <div className="text-right shrink-0">
        {price
          ? <div className={`text-2xl font-bold leading-none ${ACCENT[accent].text}`}>{price}{unit && <span className="text-sm font-normal">{unit}</span>}</div>
          : <div className="text-sm text-zinc-500 leading-none pt-1">No price yet</div>}
        {priceNote && <div className="text-xs text-zinc-400 mt-1">{priceNote}</div>}
      </div>
    </div>
  );
}

/** Category / kind chips under the Weed-Beer switch. */
export function Chips<T extends string>({ accent, items, value, onChange }: { accent: Accent; items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar">
      {items.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${value === id ? `${ACCENT[accent].chip} font-semibold` : 'border-zinc-700 text-zinc-300'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Small segmented control (Pickup | Delivery, List | Map | Compass, …). */
export function Segmented<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-zinc-700">
      {items.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`px-3 py-1 ${value === id ? 'bg-zinc-200 text-black' : 'text-zinc-300'}`}>{label}</button>
      ))}
    </div>
  );
}

export function MilesSelect({ value, options, onChange }: { value: number; options: number[]; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1">
      {options.map((d) => <option key={d} value={d}>≤ {d} mi</option>)}
    </select>
  );
}

export function OpenNowToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-zinc-300">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> Open now
    </label>
  );
}

export type PlaceView = 'list' | 'map' | 'compass';
export const VIEWS: readonly (readonly [PlaceView, string])[] = [['list', 'List'], ['map', 'Map'], ['compass', 'Compass']];

/** Small text link at the bottom of a card ("🧭 Point me", "Open menu ↗"). */
export function CardLink({ accent, children, onClick, href }: { accent: Accent; children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = `text-xs underline underline-offset-2 ${ACCENT[accent].text}`;
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls} onClick={(e) => e.stopPropagation()}>{children}</a>
    : <button type="button" className={cls} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>{children}</button>;
}

/** Read/write a small preference in localStorage without crashing in private mode. */
export const pref = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** The Gibstaapp logo: a compass. Half the needle is weed green, half is beer amber. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Gibstaapp" className="shrink-0">
      <circle cx="32" cy="32" r="27" fill="#18181b" stroke="#e4e4e7" strokeWidth="3.5" />
      <g stroke="#a1a1aa" strokeWidth="3" strokeLinecap="round"><path d="M32 9v5M32 50v5M9 32h5M50 32h5" /></g>
      <g transform="rotate(35 32 32)">
        <polygon points="32,10 39,32 25,32" fill="#22c55e" />
        <polygon points="32,54 39,32 25,32" fill="#f59e0b" />
      </g>
      <circle cx="32" cy="32" r="3.5" fill="#fafafa" />
    </svg>
  );
}
