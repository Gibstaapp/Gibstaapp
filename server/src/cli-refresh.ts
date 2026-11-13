// `npm run refresh -w server`: run a refresh from the command line and print a summary.
import './sources/register.ts';
import { refreshAll } from './refresh.ts';

const status = await refreshAll();
console.table(status.sources.map((s) => ({ source: s.source, ok: s.ok, stores: s.stores, products: s.products, error: s.error ?? '' })));
process.exit(0);
