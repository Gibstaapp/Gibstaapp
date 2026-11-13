import type { BeerPrice, BeerQuery, BeerReport, Category, HomeArea, Mode, PricedItem, RankedVenue, RefreshStatus, Store, StoreOverride, UserProfile } from '@gib/shared';

const SERVER_KEY = 'gib.serverUrl';
const PASS_KEY = 'gib.pass';
const PERSONAL_KEY = 'gib.personal';
const isNative = () => !!(window as any).Capacitor?.isNativePlatform?.();

/** In the Android app the server lives on your PC (or its public link); in the browser it's the same origin. */
export function serverUrl(): string {
  const saved = localStorage.getItem(SERVER_KEY);
  return saved ? saved.replace(/\/+$/, '') : '';
}
export function setServerUrl(url: string) {
  url.trim() ? localStorage.setItem(SERVER_KEY, url.trim()) : localStorage.removeItem(SERVER_KEY);
}
// The Android build knows a private ntfy topic where the PC posts its current public link.
const LINK_TOPIC = import.meta.env.VITE_LINK_TOPIC as string | undefined;
export const needsServerUrl = () => import.meta.env.VITE_STATIC !== '1' && isNative() && !LINK_TOPIC && !localStorage.getItem(SERVER_KEY);

/** Find the PC's current public link (it changes when the PC restarts). */
export async function discoverServer(): Promise<string | null> {
  if (!LINK_TOPIC) return null;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(LINK_TOPIC)}/json?poll=1&since=24h`);
    const lines = (await res.text()).trim().split('\n').filter(Boolean);
    for (const line of lines.reverse()) {
      const msg = JSON.parse(line).message as string | undefined;
      if (msg && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(msg.trim())) {
        setServerUrl(msg.trim());
        return msg.trim();
      }
    }
  } catch { /* offline */ }
  return null;
}

import { staticApi } from './staticApi.ts';

export class AuthError extends Error {}

export const passcode = () => localStorage.getItem(PASS_KEY) ?? '';
export function setPasscode(p: string) { localStorage.setItem(PASS_KEY, p); }

async function call<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  if (isNative() && LINK_TOPIC && !localStorage.getItem(SERVER_KEY)) await discoverServer();
  let res: Response;
  try {
    res = await fetch(serverUrl() + path, {
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), 'x-gib-pass': passcode(), ...init?.headers },
    });
  } catch (e) {
    // Saved link is dead (PC restarted -> new link): look up the current one and retry once.
    if (!retried && isNative() && LINK_TOPIC) {
      const before = serverUrl();
      const found = await discoverServer();
      if (found && found !== before) return call<T>(path, init, true);
    }
    throw new Error("Can't reach your PC. Is it on and awake?");
  }
  // Cloudflare answers 530/502/1033 pages for a dead tunnel.
  if ([502, 530].includes(res.status) && !retried && isNative() && LINK_TOPIC) {
    const before = serverUrl();
    const found = await discoverServer();
    if (found && found !== before) return call<T>(path, init, true);
  }
  if (res.status === 401) throw new AuthError('passcode required');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---- per-person settings: saved on this phone, so friends sharing the link don't clash ----
type Personal = Pick<UserProfile, 'homeZip' | 'radiusMiles' | 'veteran' | 'senior' | 'student' | 'visitedStoreIds' | 'onboarded'>;
const PERSONAL_FIELDS = ['homeZip', 'radiusMiles', 'veteran', 'senior', 'student', 'visitedStoreIds', 'onboarded'] as const;

function loadPersonal(): Partial<Personal> {
  try { return JSON.parse(localStorage.getItem(PERSONAL_KEY) ?? '{}'); } catch { return {}; }
}
function savePersonal(p: Partial<Personal>) { localStorage.setItem(PERSONAL_KEY, JSON.stringify(p)); }
const personalOf = (p: UserProfile): Personal => Object.fromEntries(PERSONAL_FIELDS.map((k) => [k, p[k]])) as Personal;

async function mergedProfile(): Promise<UserProfile> {
  const server = await call<UserProfile>('/api/profile');
  const mine = loadPersonal();
  // First time on this phone: start from server defaults, but ask the onboarding questions.
  return { ...server, onboarded: false, visitedStoreIds: [], veteran: false, senior: false, student: false, ...mine };
}

export interface StoreRow { store: Store; detected: Store; override: StoreOverride | null }

const serverApi = {
  auth: (pass: string) => call<{ ok: boolean }>('/api/auth', { method: 'POST', body: JSON.stringify({ pass }) }),
  items: (p: { category?: Category; mode: Mode; maxMiles?: number; search?: string; openNow?: boolean }) =>
    call<PricedItem[]>('/api/items', { method: 'POST', body: JSON.stringify({ ...p, profile: loadPersonal() }) }),
  stores: () => call<StoreRow[]>('/api/stores'),
  setOverride: (storeId: string, o: Partial<StoreOverride>) => call<StoreOverride>(`/api/stores/${encodeURIComponent(storeId)}/override`, { method: 'PUT', body: JSON.stringify(o) }),
  profile: mergedProfile,
  /** Personal fields stay on this phone; server-wide ones (morning notification) go to the server. */
  saveProfile: async (p: Partial<UserProfile>): Promise<UserProfile> => {
    const cur = await mergedProfile();
    const next = { ...cur, ...p };
    savePersonal(personalOf(next));
    const serverPatch: Partial<UserProfile> = {};
    if (p.ntfyTopic !== undefined && p.ntfyTopic !== cur.ntfyTopic) serverPatch.ntfyTopic = p.ntfyTopic;
    if (p.notifyHour !== undefined && p.notifyHour !== cur.notifyHour) serverPatch.notifyHour = p.notifyHour;
    if (Object.keys(serverPatch).length) await call<UserProfile>('/api/profile', { method: 'PUT', body: JSON.stringify(serverPatch) });
    return mergedProfile();
  },
  setVisited: async (storeId: string, visited: boolean): Promise<UserProfile> => {
    const mine = loadPersonal();
    const set = new Set(mine.visitedStoreIds ?? []);
    visited ? set.add(storeId) : set.delete(storeId);
    savePersonal({ ...mine, visitedStoreIds: [...set] });
    return mergedProfile();
  },
  publicUrl: () => call<{ url: string | null }>('/api/public-url'),
  zips: () => call<Record<string, HomeArea>>('/api/zips'),
  status: () => call<RefreshStatus>('/api/status'),
  /** Refresh one city's weed data (San Diego 'us' / New York 'nyc'); none = both. */
  refresh: (region?: 'us' | 'nyc' | 'europe') => call<RefreshStatus>('/api/refresh', { method: 'POST', body: JSON.stringify(region && region !== 'europe' ? { region } : {}) }),
  testNotify: () => call<{ sent: boolean; body: string; reason?: string }>('/api/notify/test', { method: 'POST' }),

  beer: {
    venues: (q: BeerQuery) => call<{ venues: RankedVenue[]; loading: string | null }>('/api/beer/venues', { method: 'POST', body: JSON.stringify({ ...q, tzOffset: new Date().getTimezoneOffset() }) }),
    status: () => call<RefreshStatus & { venues: number; areas: number }>('/api/beer/status'),
    /** Refresh one city's beer data (San Diego 'us' / New York 'nyc' / Athens 'europe'); none = all. */
    refresh: (region?: 'us' | 'nyc' | 'europe') => call<RefreshStatus>('/api/beer/refresh', { method: 'POST', body: JSON.stringify(region ? { region } : {}) }),
    report: (r: BeerReport) => call<BeerPrice>('/api/beer/report', { method: 'POST', body: JSON.stringify(r) }),
    removeReport: (id: string) => call<{ ok: boolean }>(`/api/beer/report/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};

/** VITE_STATIC=1 builds the always-on GitHub Pages site (no server; data from the daily snapshot). */
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const api: typeof serverApi = STATIC ? staticApi : serverApi;
