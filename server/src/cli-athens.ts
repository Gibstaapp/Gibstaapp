// npm run athens -w server -- reads Athens bars' own websites for euro prices once and prints a summary.
import { refreshAthensMenus } from './beer/refresh.ts';
import { beerRepo } from './db.ts';
import { inGreece } from './hours.ts';

const s = await refreshAthensMenus();
console.table([{ source: s.source, ok: s.ok, sites: s.stores, items: s.products, error: s.error ?? '' }]);
const ids = new Set(beerRepo.venues().filter((v) => inGreece(v)).map((v) => v.id));
for (const p of beerRepo.prices().filter((p) => ids.has(p.venueId))) console.log(`€${p.price} ${p.item}${p.size ? ` (${p.size})` : ''} [${p.source}] ${p.sourceUrl ?? ''}`);
