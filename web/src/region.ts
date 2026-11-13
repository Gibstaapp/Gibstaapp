import { createContext, useContext } from 'react';
import { REGIONS, type Region } from '@gib/shared';

/** The region of the user's home area code (U.S. = San Diego, $ and miles; Europe = Athens, € and km). Set in App. */
export const RegionContext = createContext<Region>(REGIONS.us);
export const useRegion = () => useContext(RegionContext);

/** The choice closest to `miles`, so a filter saved in miles still matches when the list is in km (and back). */
export function snapTo(miles: number, choices: [number, string][]): number {
  return choices.reduce((best, [m]) => (Math.abs(m - miles) < Math.abs(best - miles) ? m : best), choices[0][0]);
}
