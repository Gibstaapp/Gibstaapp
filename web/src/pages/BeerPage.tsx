import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BEER_STATUS_SOURCES, CURRENCY_SYMBOL, MAX_RESULT_MILES, regionAt, distanceChoices, fmtDistance, type BeerPrice, type BeerSort, type BeerVenueKind, type OpenStatus, type RankedVenue, type UserProfile } from '@gib/shared';
import { snapTo, useRegion } from '../region.ts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { api, STATIC } from '../api.ts';
import { haversine } from '../geo.ts';
import Compass, { type CompassTarget } from '../compass/Compass.tsx';
import { directionsUrl, useLocation } from '../compass/sensors.ts';
import RefreshBar from '../components/RefreshBar.tsx';
import { ACCENT, CardLink, Chips, EmptyState, MilesSelect, OpenBadge, OpenNowToggle, PlaceHeader, Segmented, VIEWS, cardClass, openText, pref, type PlaceView } from '../components/Place.tsx';

const KINDS: readonly (readonly [BeerVenueKind | 'all', string])[] = [['all', 'All'], ['bar', '🍻 Bars'], ['brewery', '🏭 Breweries'], ['store', '🏪 Stores']];
const SORTS: readonly (readonly [BeerSort, string])[] = [['best', 'Best'], ['cheapest', 'Cheapest'], ['closest', 'Closest']];
const DISTANCES_MI = [1, 2, 5, 10, 20, 40], DISTANCES_KM = [1, 2, 5, 10, 20, 50];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_ICON: Record<BeerVenueKind, string> = { bar: '🍻', brewery: '🏭', store: '🏪' };

/** $5 / €5.50: each price keeps the currency it was posted in (San Diego data is dollars). */
const money = (n: number, currency: BeerPrice['currency'] = 'USD') => `${CURRENCY_SYMBOL[currency ?? 'USD']}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
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
  if (p.sourceUrl) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">From their menu · {new Date(p.reportedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">Added by us</span>;
}
const sizeLabel = (p: Pick<BeerPrice, 'size'>) => (p.size ? ` · ${p.size}` : '');
const venueOpen = (r: RankedVenue): OpenStatus => ({ isOpen: r.isOpen, label: r.hoursLabel, ...(r.closingSoon ? { closingSoon: true } : {}) });

/** Under the big price: what kind of price it is ("Happy hour till 6pm"). */
function priceNote(r: RankedVenue): ReactNode {
  if (!r.best) return r.happyHourNow ? <span className="text-amber-300 font-semibold">Happy hour now</span> : null;
  if (r.best.kind === 'happy_hour') return <span className="text-amber-300 font-semibold">{r.best.label}{r.best.end ? ` till ${t12(r.best.end)}` : ''}</span>;
  if (r.best.kind === 'special') return <span className="text-amber-300 font-semibold">{r.best.label}</span>;
  return r.best.label;
}

/** One place in the beer list. Same layout as a weed deal card. */
function VenueCard({ r, rank, onOpen, onPointMe }: { r: RankedVenue; rank: number; onOpen: () => void; onPointMe: () => void }) {
  return (
    <article onClick={onOpen} className={`${cardClass('beer')} cursor-pointer active:bg-zinc-800`}>
      <PlaceHeader accent="beer" rank={rank} icon={KIND_ICON[r.venue.kind]} name={r.venue.name}
        distanceMiles={r.distanceMiles} address={r.venue.address} open={venueOpen(r)}
        price={r.best ? money(r.best.price, r.best.currency) : undefined} priceNote={priceNote(r)} />
      {r.best && (
        <div>
          <p className="font-medium leading-snug">{r.best.item}{sizeLabel(r.best)}</p>
          {r.best.snippet && <p className="text-xs text-zinc-500 line-clamp-2">“{r.best.snippet}”</p>}
        </div>
      )}
      {r.best && (
        <div className="flex flex-wrap gap-1.5">
          {r.best && sourceBadge(r.best)}
          {r.best && r.best.kind === 'regular' && r.happyHourNow && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-semibold">Happy hour now</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <CardLink accent="beer" onClick={onPointMe}>🧭 Point me</CardLink>
        <CardLink accent="beer" onClick={onOpen}>Details & report a price</CardLink>
      </div>
    </article>
  );
}

export default function BeerPage({ profile, top }: { profile: UserProfile; top: ReactNode }) {
  const [kind, setKind] = useState<BeerVenueKind | 'all'>(() => (pref.get('gib.beer.kind') as BeerVenueKind) || 'all');
  const [sort, setSort] = useState<BeerSort>(() => (pref.get('gib.beer.sort') as BeerSort) || 'best');
  const [openNow, setOpenNow] = useState(() => pref.get('gib.beer.open') !== '0');
  const region = useRegion();
  const choices = distanceChoices(region.units, DISTANCES_MI, DISTANCES_KM);
  const [maxMiles, setMaxMiles] = useState(() => snapTo(Number(pref.get('gib.beer.miles')) || 10, choices));
  // Your city's own daily refresh: San Diego ($) and Athens (€) update separately.
  const statusFn = useCallback(async () => {
    const s = await api.beer.status();
    const sources = s.sources.filter((x) => BEER_STATUS_SOURCES[region.id].includes(x.source));
    return { ...s, sources, lastRefreshAt: sources.map((x) => x.finishedAt).sort().pop() ?? s.lastRefreshAt };
  }, [region.id]);
  const [view, setView] = useState<PlaceView>(() => (pref.get('gib.beer.view') as PlaceView) || 'list');
  const [list, setList] = useState<RankedVenue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<RankedVenue | null>(null);
  const [loadingNote, setLoadingNote] = useState<string | null>(null);
  const home = useMemo(() => ({ lat: profile.lat, lng: profile.lng }), [profile.lat, profile.lng]);
  const { fix, error: locError, retry } = useLocation(home);
  // Re-query only when we've moved a bit, not on every GPS jitter.
  const [queryAt, setQueryAt] = useState(home);
  // Search around where you are, unless that's more than 100 mi from your home area code: then around home
  // (results never come from more than MAX_RESULT_MILES away from it, so San Diego and Athens stay apart).
  const awayFromHome = fix.source === 'gps' && haversine(home.lat, home.lng, fix.lat, fix.lng) > MAX_RESULT_MILES;
  useEffect(() => {
    const want = awayFromHome ? home : { lat: fix.lat, lng: fix.lng };
    if (haversine(queryAt.lat, queryAt.lng, want.lat, want.lng) > 0.15) setQueryAt(want);
  }, [fix, queryAt, home, awayFromHome]);

  useEffect(() => {
    pref.set('gib.beer.kind', kind); pref.set('gib.beer.sort', sort); pref.set('gib.beer.view', view);
    pref.set('gib.beer.open', openNow ? '1' : '0'); pref.set('gib.beer.miles', String(maxMiles));
  }, [kind, sort, view, openNow, maxMiles]);

  const load = useCallback(() => {
    setError(null);
    api.beer.venues({ lat: queryAt.lat, lng: queryAt.lng, home, kind, sort, openNow, maxMiles, limit: 200 })
      .then((r) => { setList(r.venues); setLoadingNote(r.loading); setIdx(0); })
      .catch((e) => setError(String(e.message ?? e)));
  }, [queryAt, home, kind, sort, openNow, maxMiles]);
  useEffect(load, [load]);
  // Keep the detail sheet in sync after a report.
  const refreshDetail = useCallback(async (id: string) => {
    const r = await api.beer.venues({ lat: queryAt.lat, lng: queryAt.lng, home, kind, sort, openNow: false, maxMiles: 60, limit: 400 });
    setList((cur) => cur?.map((x) => r.venues.find((y) => y.venue.id === x.venue.id) ?? x) ?? null);
    setDetail(r.venues.find((x) => x.venue.id === id) ?? null);
  }, [queryAt, home, kind, sort]);

  const pointAt = (venueId: string) => {
    const i = list?.findIndex((x) => x.venue.id === venueId) ?? -1;
    if (i >= 0) setIdx(i);
    setDetail(null);
    setView('compass');
    window.scrollTo(0, 0);
  };

  const current = list?.[idx] ?? null;
  const target: CompassTarget | null = current && {
    id: current.venue.id, name: `${KIND_ICON[current.venue.kind]} ${current.venue.name}`, placeName: current.venue.name, lat: current.venue.lat, lng: current.venue.lng,
    headline: current.best ? (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-2xl font-bold ${ACCENT.beer.text}`}>{money(current.best.price, current.best.currency)}</span>
        <span className="text-sm text-zinc-300">{current.best.item}{sizeLabel(current.best)}</span>
      </div>
    ) : <div className="text-sm text-zinc-400">No price yet</div>,
    detail: (<>
      <div><OpenBadge s={venueOpen(current)} />{current.venue.address ? ` · ${current.venue.address}` : ''}</div>
      {current.best && <div>{priceNote(current)}</div>}
      <button onClick={() => setDetail(current)} className="text-xs underline text-zinc-300">Details & report a price</button>
    </>),
  };

  const priced = list?.filter((r) => r.best).length ?? 0;

  return (
    <div>
      <header className={`sticky top-0 z-20 ${ACCENT.beer.header} backdrop-blur border-b border-zinc-800 pt-[env(safe-area-inset-top)]`}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          {top}
          <RefreshBar onRefreshed={load} statusFn={statusFn} refreshFn={api.beer.refresh} accent="beer" />
        </div>
        <Chips accent="beer" items={KINDS} value={kind} onChange={setKind} />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
          <Segmented items={SORTS} value={sort} onChange={setSort} />
          <MilesSelect value={maxMiles} choices={choices} onChange={setMaxMiles} />
          <OpenNowToggle value={openNow} onChange={setOpenNow} />
          <div className="flex-1" />
          <Segmented items={VIEWS} value={view} onChange={setView} />
        </div>
      </header>

      {loadingNote && <div className="mx-4 mt-3 rounded-xl bg-zinc-800 px-3 py-2 text-sm text-zinc-300">{loadingNote}</div>}
      {error && <p className="m-4 p-3 rounded-lg bg-red-950 text-red-200 text-sm">{error}</p>}
      {!list && !error && <p className="p-6 text-zinc-400">Finding beer near you…</p>}
      {list && list.length === 0 && !loadingNote && (
        <EmptyState accent="beer" openNow={openNow} onShowClosed={() => setOpenNow(false)}>
          No places{openNow ? ' open right now' : ''} within {fmtDistance(maxMiles, region.units, 0)}.
          {openNow ? ' Last call was a while ago.' : ' Try a wider distance. If this is the first run, places are still loading (tap the time at the top).'}
        </EmptyState>
      )}

      {list && list.length > 0 && view === 'compass' && (
        <Compass fix={fix} target={target} side="beer" locationError={locError} onRetryLocation={retry}
          position={`${idx + 1} of ${list.length}`}
          onPrev={idx > 0 ? () => setIdx(idx - 1) : undefined}
          onNext={idx < list.length - 1 ? () => setIdx(idx + 1) : undefined} />
      )}

      {list && list.length > 0 && view === 'list' && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-zinc-500 px-1">{list.length} places{openNow ? ' open now' : ''} · {priced} with a price right now · from {fix.source === 'gps' && !awayFromHome ? 'your location' : `${region.codeName} ${profile.homeZip}`}</p>
          {awayFromHome && <p className="text-xs text-amber-300/80 px-1">You're more than {fmtDistance(MAX_RESULT_MILES, region.units, 0)} from your home {region.codeName}, so these are places near it. Change it in Settings.</p>}
          <ul className="space-y-3">
            {list.map((r, i) => (<Fragment key={r.venue.id}>
              {openNow && r.isOpen === null && (i === 0 || list[i - 1].isOpen !== null) && (
                <li className="text-xs text-zinc-500 px-1 pt-2">No hours listed for the places below. They may be closed.</li>
              )}
              <li><VenueCard r={r} rank={i + 1} onOpen={() => setDetail(r)} onPointMe={() => pointAt(r.venue.id)} /></li>
            </Fragment>))}
          </ul>
          <p className="text-xs text-zinc-500 p-2">Prices come from bar & brewery websites and from people's reports. Most bars don't post prices online. Saw one? Tap a place, then "Report a price".</p>
        </div>
      )}

      {list && view === 'map' && <BeerMap list={list} fix={fix} onPick={setDetail} />}

      {detail && <VenueSheet r={detail} onClose={() => setDetail(null)} onChanged={() => refreshDetail(detail.venue.id)}
        onCompass={() => pointAt(detail.venue.id)} />}
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
                {r.best ? <>{money(r.best.price, r.best.currency)} {r.best.item} ({r.best.label})</> : 'No price yet'}<br />
                {openText(venueOpen(r))}<br />
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
  const { units } = useRegion();
  const [reporting, setReporting] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { sheet.current?.scrollTo(0, 0); }, [r.venue.id]);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div ref={sheet} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-zinc-800 p-5 space-y-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold leading-tight">{KIND_ICON[v.kind]} {v.name}</h2>
            <p className="text-sm text-zinc-400">{fmtDistance(r.distanceMiles, units)} · <OpenBadge s={venueOpen(r)} /></p>
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
                  <span><b className="text-amber-400">{money(p.price, p.currency)}</b> {p.item}{sizeLabel(p)}</span>
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
            <p className="text-[11px] text-zinc-500 mt-1">{r.happyHours.every((h) => h.source === 'seed') ? 'From their website, checked by us.' : 'Read automatically from their website.'} Double-check before you go.</p>
          </section>
        )}

        {reporting ? <ReportForm venue={v} onDone={() => { setReporting(false); onChanged(); }} onCancel={() => setReporting(false)} />
          : <button onClick={() => setReporting(true)} className="w-full rounded-lg border border-amber-500/60 text-amber-300 py-2 text-sm font-semibold">+ Report a price</button>}
      </div>
    </div>
  );
}

function ReportForm({ venue, onDone, onCancel }: { venue: { id: string; lat: number; lng: number }; onDone: () => void; onCancel: () => void }) {
  const venueId = venue.id;
  const { currency } = regionAt(venue); // the place's currency (Athens = €)
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
      await api.beer.report({ venueId, item, price: Number(price), currency, size, kind, note, ...(timed ? { days, start, end } : {}) });
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  const inp = 'bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm';
  return (
    <section className="rounded-2xl border border-zinc-800 p-3 space-y-2">
      <h3 className="font-semibold">Report a price</h3>
      <input className={`${inp} w-full`} placeholder="Beer (e.g. Modelo, house IPA, any draft)" value={item} onChange={(e) => setItem(e.target.value)} />
      <div className="flex gap-2">
        <input className={`${inp} w-24`} inputMode="decimal" placeholder={CURRENCY_SYMBOL[currency]} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
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
      <p className="text-[11px] text-zinc-500">{STATIC ? 'Saved on this phone only for now (shared reports need the PC version).' : 'Everyone using this link sees reports, marked "Reported".'}</p>
    </section>
  );
}
