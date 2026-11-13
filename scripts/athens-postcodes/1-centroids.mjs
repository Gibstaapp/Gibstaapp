// Per postal code: median location of all OSM addresses carrying it, plus how tightly they cluster.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , addrFile, outFile] = process.argv;
const by = new Map();
for (const line of readFileSync(addrFile, 'utf8').split('\n')) {
  const [lat, lon, pc, city, suburb, cityEn] = line.split('\t');
  const code = (pc ?? '').replace(/\s+/g, '');
  if (!/^1\d{4}$/.test(code) || !lat) continue;
  (by.get(code) ?? by.set(code, []).get(code)).push({ lat: +lat, lng: +lon, city: (city || '').trim(), suburb: (suburb || '').trim() });
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const km = (a, b) => { const r = (d) => d * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const out = [];
for (const [code, pts] of by) {
  const c = { lat: med(pts.map((p) => p.lat)), lng: med(pts.map((p) => p.lng)) };
  const d = pts.map((p) => km(c, p)).sort((a, b) => a - b);
  const inner = pts.filter((p) => km(c, p) < 3);
  const top = (k) => { const m = new Map(); for (const p of inner) if (p[k]) m.set(p[k], (m.get(p[k]) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };
  out.push({ code, n: pts.length, lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), p80km: +d[Math.floor(d.length * 0.8)].toFixed(2), city: top('city'), suburb: top('suburb') });
}
out.sort((a, b) => a.code.localeCompare(b.code));
writeFileSync(outFile, JSON.stringify(out, null, 1));
const good = out.filter((o) => o.n >= 5 && o.p80km < 2.5);
console.log(`codes ${out.length}, with >=5 addresses and tight cluster: ${good.length}`);
console.log('dropped:', out.filter((o) => !good.includes(o)).map((o) => `${o.code}(n${o.n},${o.p80km}km)`).join(' '));
console.log(good.slice(0, 12).map((o) => `${o.code} n${o.n} ${o.lat},${o.lng} ${o.p80km}km ${o.city}/${o.suburb}`).join('\n'));
