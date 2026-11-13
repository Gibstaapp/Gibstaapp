import { useState } from 'react';
import type { PricedItem } from '@gib/shared';
import FinePrint from './FinePrint.tsx';
import { CardLink, PlaceHeader, cardClass } from './Place.tsx';

const $ = (n: number) => `$${n.toFixed(2)}`;
const VIA_LABEL = { weedmaps: 'Weedmaps', eaze: 'Eaze', store: 'Store' } as const;

function size(item: PricedItem) {
  const p = item.product;
  if (p.category === 'edible' || (p.category === 'other' && p.thcMg)) return p.thcMg ? `${p.thcMg}mg THC` : '';
  if (p.grams) return p.grams >= 1 ? `${+p.grams.toFixed(2)}g` : `${Math.round(p.grams * 1000)}mg`;
  return '';
}

function Badge({ children, tone = 'zinc', title }: { children: React.ReactNode; tone?: 'zinc' | 'green' | 'amber' | 'sky'; title?: string }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300',
    green: 'bg-green-950 text-green-300 border border-green-800',
    amber: 'bg-amber-950 text-amber-300 border border-amber-800',
    sky: 'bg-sky-950 text-sky-300 border border-sky-800',
  };
  return <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

export default function DealCard({ item, rank, onVisited, onPointMe }: { item: PricedItem; rank: number; onVisited: (storeId: string, visited: boolean) => void; onPointMe?: () => void }) {
  const { product: p, store: s, tax } = item;
  const [busy, setBusy] = useState(false);
  const link = p.url || s.menuUrl || s.website;
  const sz = size(item);

  const taxLabel = tax.included
    ? 'Taxes included'
    : `+${$(tax.total)} tax est.`;
  const taxTitle = tax.included ? 'Shelf price already includes all taxes' : `Local ${$(tax.local)} · CA excise ${$(tax.excise)} · Sales ${$(tax.sales)}`;

  return (
    <article className={item.closerPick ? 'rounded-2xl p-4 space-y-3 border bg-orange-500/10 border-orange-500 ring-1 ring-orange-500/40' : cardClass('weed')}>
      {item.closerPick && (
        <div className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="rounded-md bg-orange-500 text-black font-semibold px-2 py-0.5">📍 Closer pick</span>
          <span className="text-orange-200">
            {item.closerPick.milesCloser.toFixed(1)} mi closer than {item.closerPick.vsStore} ({item.closerPick.vsMiles.toFixed(1)} mi) for {item.closerPick.extraCost === 0 ? 'the same price' : `only +${$(item.closerPick.extraCost)}`}
          </span>
        </div>
      )}
      <PlaceHeader accent="weed" rank={rank} name={s.name}
        distanceMiles={item.mode === 'pickup' ? item.distanceMiles : undefined}
        address={[s.address, s.city].filter(Boolean).join(', ')}
        open={item.open ?? { isOpen: null }}
        price={$(item.perUnit)} unit={item.unitLabel} priceNote={`${$(item.otd)} out the door`} />

      {/* Product */}
      <div>
        <p className="font-medium leading-snug">{p.name}</p>
        <p className="text-xs text-zinc-400">
          {[p.brand, sz, p.thcPct ? `${p.thcPct}% THC` : '', p.strainType].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Price math */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {item.deal ? (
          <>
            <span className="text-zinc-500 line-through">{$(item.listPrice)}</span>
            <span className="text-zinc-300">→ {$(item.priceAfterDeals)}</span>
            <span className="rounded-md bg-green-500/15 text-green-300 px-2 py-0.5 text-xs font-medium">
              {item.deal.title}{item.deal.requiresQty ? ` (buy ${item.deal.requiresQty})` : ''}
            </span>
          </>
        ) : (
          <span className="text-zinc-300">{$(item.listPrice)} <span className="text-zinc-500 text-xs">no deal today</span></span>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={tax.included ? 'green' : 'zinc'} title={taxTitle}>{taxLabel}</Badge>
        {item.deliveryFee > 0 && <Badge title="Delivery fee is included in the out-the-door price">incl. {$(item.deliveryFee)} delivery</Badge>}
        {s.ownSitePickup === true && <Badge tone="green" title="You can order pickup on the dispensary's own website">Pickup on store site</Badge>}
        {s.ownSitePickup === null && s.pickup && <Badge title="Not detected yet. Set it on the Stores tab">Own-site pickup ?</Badge>}
        {s.delivery.map((d) => (
          <Badge key={d.via} tone={item.mode === 'delivery' && item.deliveryVia === d.via ? 'sky' : 'zinc'}>
            🚚 {VIA_LABEL[d.via]} {d.fee === 0 ? 'free' : $(d.fee)}{d.minimum ? ` · min ${$(d.minimum)}` : ''}{d.etaMinutes ? ` · ~${d.etaMinutes}m` : ''}
          </Badge>
        ))}
        {!s.pickup && <Badge>Delivery only</Badge>}
      </div>

      {/* First-timer pricing */}
      {item.usesFirstTime && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-700/60 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-amber-200 font-medium">First-timer price</p>
            <p className="text-amber-200/70 text-xs">
              Been here before? Regular price is {item.regularOtd != null ? $(item.regularOtd) : '—'}
              {item.regularDeal ? ` (${item.regularDeal.title})` : ''}.
            </p>
          </div>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await onVisited(s.id, true); } finally { setBusy(false); } }}
            className="rounded-lg bg-amber-400 text-black font-semibold px-3 py-1.5 text-xs disabled:opacity-50">
            I've been here
          </button>
        </div>
      )}

      <FinePrint items={item.finePrint} />

      {(link || (onPointMe && s.pickup)) && (
        <div className="flex flex-wrap gap-4">
          {onPointMe && s.pickup && <CardLink accent="weed" onClick={onPointMe}>🧭 Point me</CardLink>}
          {link && <CardLink accent="weed" href={link}>Open menu ↗</CardLink>}
        </div>
      )}
    </article>
  );
}
