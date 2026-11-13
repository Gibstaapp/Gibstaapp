// NYC ZIPs -> shared/nyc-zips.ts
//   node make.mjs <2025_Gaz_zcta_national.txt> <nyc-places.tsv> <out.ts>
// Location: U.S. Census Bureau ZCTA Gazetteer (internal point, public domain).
// Borough: from the ZIP's first digits (USPS).  Label: nearest OpenStreetMap neighbourhood (ODbL).
import { readFileSync, writeFileSync } from 'node:fs';
const [, , gazFile, placesFile, outFile] = process.argv;
const borough = (z) => {
  const p = z.slice(0, 3);
  if (['100', '101', '102'].includes(p)) return 'Manhattan';
  if (p === '103') return 'Staten Island';
  if (p === '104') return 'Bronx';
  if (p === '112') return 'Brooklyn';
  if (['111', '113', '114', '116'].includes(p) || z === '11004' || z === '11005') return 'Queens';
  return null;
};
const places = readFileSync(placesFile, 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((x) => x[3])
  .map(([lat, lon, place, name, en]) => ({ lat: +lat, lng: +lon, place, name: (en || name).trim() }))
  .filter((p) => /^[\x20-\x7e’'éèñ]+$/.test(p.name));
const km = (a, b) => { const r = (d) => d * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const rows = readFileSync(gazFile, 'utf8').trim().split('\n').slice(1).map((l) => l.split('|'));
const out = {};
for (const r of rows) {
  const zip = r[0], b = borough(zip);
  if (!b) continue;
  const p = { lat: +(+r[6]).toFixed(4), lng: +(+r[7]).toFixed(4) };
  // Must actually be in the five boroughs (a few 11xxx ZIPs are Long Island).
  if (p.lat < 40.49 || p.lat > 40.92 || p.lng < -74.27 || p.lng > -73.69) continue;
  const near = places.map((x) => ({ x, d: km(p, x) })).sort((a, c) => a.d - c.d)[0];
  out[zip] = { ...p, area: near && near.d < 2.5 ? near.x.name : b, city: b };
}
const keys = Object.keys(out).sort();
writeFileSync(outFile, `// New York City ZIPs (generated ${new Date().toISOString().slice(0, 10)} by scripts/nyc-zips/make.mjs).
// Location: U.S. Census Bureau 2025 ZCTA Gazetteer (public domain). Borough: from the ZIP's first digits.
// Area: nearest OpenStreetMap neighbourhood (© OpenStreetMap contributors, ODbL).
export const NYC_ZIPS: Record<string, { lat: number; lng: number; area: string; city: string }> = {
${keys.map((k) => `  ${JSON.stringify(k)}: { lat: ${out[k].lat}, lng: ${out[k].lng}, area: ${JSON.stringify(out[k].area)}, city: ${JSON.stringify(out[k].city)} },`).join('\n')}
};
`);
const byB = {}; for (const k of keys) byB[out[k].city] = (byB[out[k].city] ?? 0) + 1;
console.log(keys.length, 'ZIPs', JSON.stringify(byB));
for (const z of ['10001', '10003', '10011', '10014', '10025', '10027', '10301', '10451', '10458', '11101', '11201', '11211', '11215', '11354', '11375', '11432', '11691']) console.log(' ', z, out[z]?.city, '|', out[z]?.area, out[z]?.lat, out[z]?.lng);
