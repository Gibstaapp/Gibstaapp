// npm run beer -- refreshes beer places/prices once and prints a summary.
import { refreshBeer } from './beer/refresh.ts';
import { beerRepo } from './db.ts';

// --region us (San Diego, $), nyc (New York, $) or europe (Athens, €); default: all, one after the other.
const r = process.argv[process.argv.indexOf('--region') + 1];
const statuses = await refreshBeer({ forceOsm: process.argv.includes('--osm'), ...(r === 'us' || r === 'nyc' || r === 'europe' ? { region: r } : {}) });
console.table(statuses.map((s) => ({ source: s.source, ok: s.ok, places: s.stores, items: s.products, error: s.error ?? '' })));
console.log(`places: ${beerRepo.venues().length}, prices: ${beerRepo.prices().length}, happy hours: ${beerRepo.happyHours().length}`);
