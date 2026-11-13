// Dev tool: run one adapter by itself and print a summary + samples.
//   npx tsx src/sources/try-source.ts weedmaps
import { DEFAULT_PROFILE } from '../db.ts';
import type { SourceAdapter } from './types.ts';

const name = process.argv[2];
if (!name) { console.error('usage: try-source.ts <dutchie|jane|weedmaps|eaze|sample>'); process.exit(1); }
const mod = await import(`./${name}.ts`);
const adapter: SourceAdapter = mod[`${name}Adapter`];
const area = { lat: DEFAULT_PROFILE.lat, lng: DEFAULT_PROFILE.lng, radiusMiles: DEFAULT_PROFILE.radiusMiles, zip: DEFAULT_PROFILE.homeZip };
const t0 = Date.now();
const r = await adapter.fetchAll(area, (m) => console.log(`[${name}] ${m}`));
console.log(`\n${r.stores.length} stores, ${r.products.length} products, ${r.deals.length} deals in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('\nStores:', JSON.stringify(r.stores.slice(0, 3), null, 2));
console.log('\nProducts:', JSON.stringify(r.products.slice(0, 5), null, 2));
console.log('\nDeals:', JSON.stringify(r.deals.slice(0, 5), null, 2));
const byCat: Record<string, number> = {};
for (const p of r.products) byCat[p.category] = (byCat[p.category] ?? 0) + 1;
console.log('\nBy category:', byCat);
console.log('Missing grams (non-edible):', r.products.filter((p) => !p.grams && !['edible', 'other'].includes(p.category)).length);
process.exit(0);
