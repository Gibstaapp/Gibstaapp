import { useState } from 'react';
import type { FinePrintItem } from '@gib/shared';

/** Important conditions are always visible and highlighted; the rest collapse behind "more". */
export default function FinePrint({ items }: { items: FinePrintItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const important = items.filter((i) => i.important);
  const rest = items.filter((i) => !i.important);
  return (
    <div className="text-xs space-y-1">
      {important.length > 0 && (
        <ul className="rounded-lg bg-amber-500/10 border-l-2 border-amber-400 px-2 py-1.5 space-y-0.5">
          {important.map((i) => <li key={i.text} className="text-amber-200">⚠ {i.text}</li>)}
        </ul>
      )}
      {rest.length > 0 && (
        <div className="text-zinc-400">
          {open ? (
            <ul className="space-y-0.5 pl-1">{rest.map((i) => <li key={i.text}>• {i.text}</li>)}</ul>
          ) : null}
          <button onClick={() => setOpen(!open)} className="text-zinc-500 underline underline-offset-2">
            {open ? 'less' : `fine print (${rest.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
