import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BeerPrice, BeerSort, BeerVenueKind, RankedVenue, UserProfile } from '@gib/shared';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { api } from '../api.ts';
import { haversine } from '../geo.ts';
import Compass, { type CompassTarget } from '../compass/Compass.tsx';
import { directionsUrl, useLocation } from '../compass/sensors.ts';
import RefreshBar from '../components/RefreshBar.tsx';

export type BeerView = 'compass' | 'list' | 'map';
const AMBER = '#f59e0b';
const KINDS: [BeerVenueKind | 'all', string][] = [['all', 'All'], ['bar', '🍻 Bars'], ['brewery', '🏭 Breweries'], ['store', '🏪 Stores']];
const SORTS: [BeerSort, string][] = [['best', 'Best'], ['cheapest', 'Cheapest'], ['closest', 'Closest']];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_ICON: Record<BeerVenueKind, string> = { bar: '🍻', brewery: '🏭', store: '🏪' };

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
const t12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
export function daysLabel(days?: number[]) {
  if (!days?.length) return 'Days not listed';
  if (days.length === 7) return 'Daily';
  const s = [...days].sort().join();
  if (s === '1,2,3,4,5') return 'Mon–Fri';
  if (s === '0,6') return 'Weekends';
  return days.map((d) => DAYS[d]).join(', ');
}
const whenLabel = (p: { days?: number[]; start?: string; end?: string }) =>
  p.start && p.end ? `${p.days?.length ? daysLabel(p.days) + ' ' : ''}${t12(p.start)}–${t12(p.end)}${p.days?.length ? '' : ' (days not listed)'}` : p.days?.length ? daysLabel(p.days) : '';
function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400_000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)} days ago` : new Date(iso).toLocaleDateString();
}
function sourceBadge(p: BeerPrice): ReactNode {
  if (p.source === 'team') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">✔ Verified</span>;
  if (p.source === 'user') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">Reported {ago(p.reportedAt)}</span>;
  if (p.source === 'website') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">From their website</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">Added by us</span>;
}
const sizeLabel = (p: Pick<BeerPrice, 'size'>) => (p.size ? ` · ${p.size}` : '');

function OpenLine({ r }: { r: RankedVenue }) {
  if (r.isOpen === null) return <span className="text-zinc-500">Hours unknown</span>;
  return <span className={r.isOpen ? 'text-green-400' : 'text-red-400'}>{r.hoursLabel ?? (r.isOpen ? 'Open' : 'Closed')}</span>;
}

function PriceHeadline({ r }: { r: RankedVenue }) {
  if (!r.best) {
    return <div className="text-sm text-zinc-400">{r.happyHourNow ? <span className="text-amber-300 font-semibold">🍺 Happy hour now · </span> : null}No price yet</div>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-2xl font-bold text-amber-400">{money(r.best.price)}</span>
      <span className="text-sm text-zinc-300">{r.best.item}{sizeLabel(r.best)}</span>
      {r.best.kind !== 'regular' && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-500 text-black">{r.best.label}{r.best.kind === 'happy_hour' && r.best.end ? ` till ${t12(r.best.end)}` : ''}</span>}
      {r.best.kind === 'regular' && r.happyHourNow && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-500 text-black">Happy hour now</span>}
    </div>
  );
}

export default function BeerPage({ profile, view, top }: { profile: UserProfile; view: BeerView; top: ReactNode }) {
  const [kind, setKind] = useState<BeerVenueKind | 'all'>(() => (localStorage.getItem('gib.beer.kind') as BeerVenueKind) || 'all');
  const [sort, setSort] = useState<BeerSort>(() => (localStorage.getItem('gib.beer.sort') as BeerSort) || 'best');
  const [openNow, setOpenNow] = useState(() => localStorage.getItem('gib.beer.open') !== '0');
  const [maxMiles, setMaxMiles] = useState(() => Number(localStorage.getItem('gib.beer.miles')) || 10);
  const [list, setList] = useState<RankedVenue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<RankedVenue | null>(null);
  const [loadingNote, setLoadingNote] = useState<string | null>(null);
  const home = useMemo(() => ({ lat: profile.lat, lng: profile.lng }), [profile.lat, profile.lng]);
  const { fix, error: locError, retry } = useLocation(home);
  // Re-query only when we've moved a bit, not on every GPS jitter.
  const [queryAt, setQueryAt] = useState(home);
  useEffect(() => { if (haversine(queryAt.lat, queryAt.lng, fix.lat, fix.lng) > 0.15) setQueryAt({ lat: fix.lat, lng: fix.lng }); }, [fix, queryAt]);

  useEffect(() => {
    localStorage.setItem('gib.beer.kind', kind); localStorage.setItem('gib.beer.sort', sort);
    localStorage.setItem('gib.beer.open', openNow ? '1' : '0'); localStorage.setItem('gib.beer.miles', String(maxMiles));
  }, [kind, sort, openNow, maxMiles]);

  const load = useCallback(() => {
    setError(null);
    api.beer.venues({ lat: queryAt.lat, lng: queryAt.lng, kind, sort, openNow, maxMiles, limit: 200 })
      .then((r) => { setList(r.venues); setLoadingNote(r.loading); setIdx(0); })
      .catch((e) => setError(String(e.message ?? e)));
  }, [queryAt, kind, sort, openNow, maxMiles]);
  useEffect(load, [load]);
  // Keep the detail sheet in sync after a report.
  const refreshDetail = useCallback(async (id: string) => {
    const r = await api.beer.venues({ lat: queryAt.lat, lng: queryAt.lng, kind, sort, openNow: false, maxMiles: 60, limit: 400 });
    setList((cur) => cur?.map((x) => r.venues.find((y) => y.venue.id === x.venue.id) ?? x) ?? null);
    setDetail(r.venues.find((x) => x.venue.id === id) ?? null);
  }, [queryAt, kind, sort]);

  const current = list?.[idx] ?? null;
  const target: CompassTarget | null = current && {
    id: current.venue.id, name: `${KIND_ICON[current.venue.kind]} ${current.venue.name}`, lat: current.venue.lat, lng: current.venue.lng,
    headline: <PriceHeadline r={current} />,
    detail: (<>
      <div><OpenLine r={current} />{current.venue.address ? ` · ${current.venue.address}` : ''}</div>
      {current.best?.snippet && <div className="text-xs text-zinc-500 line-clamp-2">“{current.best.snippet}”</div>}
      <button onClick={() => setDetail(current)} className="text-xs underline text-zinc-300">Details & report a price</button>
    </>),
  };

  const priced = list?.filter((r) => r.best).length ?? 0;

  return (
    <div>
      <header className="sticky top-0 z-20 bg-[#14110b]/95 backdrop-blur border-b border-zinc-800 pt-[env(safe-area-inset-top)]">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          {top}
          <RefreshBar onRefreshed={load} statusFn={api.beer.status} refreshFn={api.beer.refresh} />
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar">
          {KINDS.map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${kind === k ? 'bg-amber-500 text-black border-amber-500 font-semibold' : 'border-zinc-700 text-zinc-300'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {SORTS.map(([s, label]) => (
              <button key={s} onClick={() => setSort(s)} className={`px-3 py-1 ${sort === s ? 'bg-zinc-200 text-black' : 'text-zinc-300'}`}>{label}</button>
            ))}
          </div>
          <select value={maxMiles} onChange={(e) => setMaxMiles(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1">
            {[1, 2, 5, 10, 20, 40].map((d) => <option key={d} value={d}>≤ {d} mi</option>)}
          </select>
          <label className="flex items-center gap-1 text-zinc-300"><input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} /> Open now</label>
        </div>
      </header>

      {loadingNote && <div className="mx-4 mt-3 rounded-xl bg-zinc-800 px-3 py-2 text-sm text-zinc-300">{loadingNote}</div>}
      {error && <p className="p-4 text-red-400 text-sm">{error}</p>}
      {!list && !error && <p className="p-6 text-zinc-400">Finding beer near you…</p>}
      {list && list.length === 0 && !loadingNote && (
        <p className="p-6 text-zinc-400 text-sm">Nothing matches. Try a bigger distance{openNow ? ' or turn off "Open now"' : ''}. If this is the first run, places are still loading (tap ↻ status).</p>
      )}

      {list && list.length > 0 && view === 'compass' && (
        <Compass fix={fix} target={target} accent={AMBER} locationError={locError} onRetryLocation={retry}
          position={`${idx + 1} of ${list.length}`}
          onPrev={idx > 0 ? () => setIdx(idx - 1) : undefined}
          onNext={idx < list.length - 1 ? () => setIdx(idx + 1) : undefined} />
      )}

      {list && list.length > 0 && view === 'list' && (
        <div className="p-3 space-y-2">
          <p className="text-xs text-zinc-500 px-1">{list.length} places · {priced} with a price right now · from {fix.source === 'gps' ? 'your location' : `ZIP ${profile.homeZip}`}</p>
          {list.map((r, i) => (
            <button key={r.venue.id} onClick={() => setDetail(r)} className="w-full text-left rounded-2xl bg-zinc-900 border border-zinc-800 p-3 space-y-1 active:bg-zinc-800">
              <div className="flex justify-between gap-2">
                <div className="font-semibold leading-tight">{KIND_ICON[r.venue.kind]} {r.venue.name}</div>
                <div className="text-xs text-zinc-400 shrink-0">{r.distanceMiles.toFixed(1)} mi</div>
              </div>
              <PriceHeadline r={r} />
              <div className="text-xs text-zinc-400 flex flex-wrap gap-x-2 items-center"><OpenLine r={r} />{r.best && sourceBadge(r.best)}
                <span className="ml-auto text-amber-300" onClick={(e) => { e.stopPropagation(); setIdx(i); window.dispatchEvent(new CustomEvent('gib:beer-view', { detail: 'compass' })); }}>🧭 Point me</span>
              </div>
            </button>
          ))}
          <p className="text-xs text-zinc-500 p-2">Prices come from bar & brewery websites and from people's reports. Most bars don't post prices online. Saw one? Tap a place, then "Report a price".</p>
        </div>
      )}

      {list && view === 'map' && <BeerMap list={list} fix={fix} onPick={setDetail} />}

      {detail && <VenueSheet r={detail} onClose={() => setDetail(null)} onChanged={() => refreshDetail(detail.venue.id)}
        onCompass={() => { const i = list?.findIndex((x) => x.venue.id === detail.venue.id) ?? -1; if (i >= 0) setIdx(i); setDetail(null); window.dispatchEvent(new CustomEvent('gib:beer-view', { detail: 'compass' })); }} />}
    </div>
  );
}

function BeerMap({ list, fix, onPick }: { list: RankedVenue[]; fix: { lat: number; lng: number }; onPick: (r: RankedVenue) => void }) {
  const prices = list.filter((r) => r.best).map((r) => r.best!.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const color = (r: RankedVenue) => {
    if (!r.best) return '#71717a';
    const t = max === min ? 0 : (r.best.price - min) / (max - min);
    return `hsl(${45 - t * 40} 95% ${55 - t * 10}%)`;
  };
  return (
    <div className="h-[calc(100vh-14rem)] m-3 rounded-2xl overflow-hidden border border-zinc-800">
      <MapContainer center={[fix.lat, fix.lng]} zoom={13} className="h-full w-full">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <CircleMarker center={[fix.lat, fix.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }}><Popup>You</Popup></CircleMarker>
        {list.map((r) => (
          <CircleMarker key={r.venue.id} center={[r.venue.lat, r.venue.lng]} radius={r.best ? 10 : 6}
            pathOptions={{ color: '#000', weight: 1, fillColor: color(r), fillOpacity: r.isOpen === false ? 0.35 : 0.95 }}>
            <Popup>
              <div className="text-sm">
                <strong>{r.venue.name}</strong><br />
                {r.best ? <>{money(r.best.price)} {r.best.item} ({r.best.label})</> : 'No price yet'}<br />
                {r.hoursLabel ?? (r.isOpen === null ? 'Hours unknown' : '')}<br />
                <button className="underline" onClick={() => onPick(r)}>Details</button>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function VenueSheet({ r, onClose, onChanged, onCompass }: { r: RankedVenue; onClose: () => void; onChanged: () => void; onCompass: () => void }) {
  const v = r.venue;
  const [reporting, setReporting] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { sheet.current?.scrollTo(0, 0); }, [r.venue.id]);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div ref={sheet} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-zinc-800 p-5 space-y-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold leading-tight">{KIND_ICON[v.kind]} {v.name}</h2>
            <p className="text-sm text-zinc-400">{r.distanceMiles.toFixed(1)} mi · <OpenLine r={r} /></p>
            {v.address && <p className="text-sm text-zinc-400">{v.address}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-400 text-2xl leading-none">×</button>
        </div>
        <div className="flex gap-2 text-sm">
          <button onClick={onCompass} className="flex-1 rounded-lg bg-amber-500 text-black font-semibold py-2">🧭 Compass</button>
          <a href={directionsUrl(v.lat, v.lng)} target="_blank" rel="noreferrer" className="flex-1 text-center rounded-lg bg-zinc-800 py-2">Directions</a>
          {v.website && <a href={v.website} target="_blank" rel="noreferrer" className="flex-1 text-center rounded-lg bg-zinc-800 py-2">Website</a>}
          {v.phone && <a href={`tel:${v.phone}`} className="rounded-lg bg-zinc-800 px-3 py-2">📞</a>}
        </div>

        <section>
          <h3 className="font-semibold mb-1">Prices we know</h3>
          {r.prices.length === 0 && <p className="text-sm text-zinc-500">None yet. Be the first to add one.</p>}
          <ul className="space-y-2">
            {r.prices.map((p) => (
              <li key={p.id} className={`rounded-xl border p-2.5 text-sm ${r.best?.id === p.id ? 'border-amber-500/70 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900'}`}>
                <div className="flex justify-between gap-2">
                  <span><b className="text-amber-400">{money(p.price)}</b> {p.item}{sizeLabel(p)}</span>
                  {sourceBadge(p)}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {p.kind === 'happy_hour' ? 'Happy hour' : p.kind === 'special' ? 'Special' : 'Regular'}
                  {whenLabel(p) ? ` · ${whenLabel(p)}` : ''}
                  {r.best?.id === p.id ? ' · ✅ applies now' : ''}
                </div>
                {p.snippet && <div className="text-xs text-zinc-500 mt-1">“{p.snippet}”</div>}
                {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 underline">source</a>}
                {p.source === 'user' && <button onClick={async () => { await api.beer.removeReport(p.id); onChanged(); }} className="text-[11px] text-zinc-500 underline ml-2">remove</button>}
              </li>
            ))}
          </ul>
        </section>

        {r.happyHours.length > 0 && (
          <section>
            <h3 className="font-semibold mb-1">Happy hour {r.happyHourNow && <span className="text-xs ml-1 px-1.5 py-0.5 rounded bg-amber-500 text-black">NOW</span>}</h3>
            <ul className="space-y-1.5">
              {r.happyHours.map((h, i) => (
                <li key={i} className="text-sm">
                  <b>{whenLabel(h)}</b>
                  <div className="text-xs text-zinc-500">“{h.text}” {h.sourceUrl && <a href={h.sourceUrl} target="_blank" rel="noreferrer" className="underline">source</a>}</div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-500 mt-1">Read automatically from their website. Double-check before you go.</p>
          </section>
        )}

        {reporting ? <ReportForm venueId={v.id} onDone={() => { setReporting(false); onChanged(); }} onCancel={() => setReporting(false)} />
          : <button onClick={() => setReporting(true)} className="w-full rounded-lg border border-amber-500/60 text-amber-300 py-2 text-sm font-semibold">+ Report a price</button>}
      </div>
    </div>
  );
}

function ReportForm({ venueId, onDone, onCancel }: { venueId: string; onDone: () => void; onCancel: () => void }) {
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('pint');
  const [kind, setKind] = useState<BeerPrice['kind']>('regular');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('15:00');
  const [end, setEnd] = useState('18:00');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const timed = kind === 'happy_hour' || kind === 'special';
  const submit = async () => {
    setErr(null);
    try {
      await api.beer.report({ venueId, item, price: Number(price), size, kind, note, ...(timed ? { days, start, end } : {}) });
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  const inp = 'bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm';
  return (
    <section className="rounded-2xl border border-zinc-800 p-3 space-y-2">
      <h3 className="font-semibold">Report a price</h3>
      <input className={`${inp} w-full`} placeholder="Beer (e.g. Modelo, house IPA, any draft)" value={item} onChange={(e) => setItem(e.target.value)} />
      <div className="flex gap-2">
        <input className={`${inp} w-24`} inputMode="decimal" placeholder="$" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
        <select className={`${inp} flex-1`} value={size} onChange={(e) => setSize(e.target.value)}>
          {['pint', '12oz', '16oz', '20oz', '24oz', '6-pack', '12-pack', 'pitcher'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className={`${inp} flex-1`} value={kind} onChange={(e) => setKind(e.target.value as BeerPrice['kind'])}>
          <option value="regular">Regular</option><option value="happy_hour">Happy hour</option><option value="special">Day special</option>
        </select>
      </div>
      {timed && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                className={`flex-1 rounded py-1 text-xs ${days.includes(i) ? 'bg-amber-500 text-black font-semibold' : 'bg-zinc-800 text-zinc-400'}`}>{d[0]}</button>
            ))}
          </div>
          <div className="flex gap-2 items-center text-sm">
            <input type="time" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /> to
            <input type="time" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      <input className={`${inp} w-full`} placeholder="Note (optional): where you saw it, conditions" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} className="flex-1 rounded-lg bg-amber-500 text-black font-semibold py-2 text-sm">Save</button>
        <button onClick={onCancel} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm">Cancel</button>
      </div>
      <p className="text-[11px] text-zinc-500">Everyone using this link sees reports, marked "Reported".</p>
    </section>
  );
}
