// Label each Athens postal code with the nearest named OSM place (English name, else ELOT 743 transliteration).
import { readFileSync, writeFileSync } from 'node:fs';
const [, , pcFile, placesFile, outFile] = process.argv;
const codes = JSON.parse(readFileSync(pcFile, 'utf8'));
const places = readFileSync(placesFile, 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((x) => x[3])
  .map(([lat, lon, place, name, en]) => ({ lat: +lat, lng: +lon, place, name, en }));

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const MAP = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
const VOICED = /[βγδζλμνραεηιουω]/;
function translit(greek) {
  const s = strip(greek).toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1] ?? '', start = i === 0 || /[\s\-(]/.test(s[i - 1]);
    const two = c + n;
    if (two === 'ου') { out += 'ou'; i++; continue; }
    if ((two === 'αυ' || two === 'ευ' || two === 'ηυ') && n) {
      const after = s[i + 2] ?? '';
      out += MAP[c] + (after && VOICED.test(after) ? 'v' : after ? 'f' : 'f'); i++; continue;
    }
    if (two === 'γγ') { out += 'ng'; i++; continue; }
    if (two === 'γκ') { out += start ? 'g' : 'gk'; i++; continue; }
    if (two === 'μπ') { out += start ? 'b' : 'mp'; i++; continue; }
    if (two === 'ντ') { out += start ? 'd' : 'nt'; i++; continue; }
    out += MAP[c] ?? c;
  }
  return out.replace(/(^|[\s\-(])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}
const km = (a, b) => { const r = (d) => d * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const label = (p) => (p.en && /^[\x20-\x7e]+$/.test(p.en) ? p.en : translit(p.name)).trim();

const LOCAL = new Set(['neighbourhood', 'quarter', 'suburb']);
const out = {};
let kept = 0;
for (const c of codes) {
  const n = Number(c.code);
  if (n < 10000 || n > 18999 || (n >= 18000 && n < 18100)) continue;   // greater Athens + Piraeus; 180xx are islands
  if (c.n < 5 || c.p80km > 4) continue;                                   // too few addresses / too spread out to place
  const near = places.map((p) => ({ p, d: km(c, p) })).sort((a, b) => a.d - b.d);
  const pick = near.find((x) => LOCAL.has(x.p.place) && x.d < 1.2) ?? near.find((x) => x.p.place !== 'neighbourhood') ?? near[0];
  // Municipality: what the addresses themselves say (addr:city), in English when a place of that name has one.
  const cityGreek = strip(c.city || '').toLowerCase();
  const match = cityGreek && places.find((p) => strip(p.name).toLowerCase() === cityGreek && p.place !== 'neighbourhood');
  const city = c.city ? (match ? label(match) : translit(c.city)) : '';
  const area = label(pick.p);
  out[`${c.code.slice(0, 3)} ${c.code.slice(3)}`] = { lat: c.lat, lng: c.lng, area: area === city ? area : area, city: city || area };
  kept++;
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log('kept', kept);
for (const [k, v] of Object.entries(out).filter((_, i) => i % 12 === 0)) console.log(k, '|', v.city, '|', v.area);
const cities = {}; for (const v of Object.values(out)) cities[v.city] = (cities[v.city] ?? 0) + 1;
console.log(Object.keys(cities).length, 'municipalities:', Object.entries(cities).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(', '));
