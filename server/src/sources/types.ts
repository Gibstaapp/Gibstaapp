import type { Deal, Product, SourceId, Store } from '@gib/shared';

export interface SearchArea {
  lat: number;
  lng: number;
  radiusMiles: number;
  zip: string;
  /** Which state's rules apply (Dutchie tax state, which sources serve it). */
  state: 'CA' | 'NY';
}

export interface SourceResult {
  stores: Store[];
  products: Product[];
  deals: Deal[];
}

/** Every data source implements this. Store ids must be `${source}:${externalId}`; merging happens later. */
export interface SourceAdapter {
  id: SourceId;
  enabled: () => boolean;
  /** States this source covers; missing = any. (Eaze delivers in California only.) */
  states?: ('CA' | 'NY')[];
  fetchAll(area: SearchArea, log: (msg: string) => void): Promise<SourceResult>;
}
