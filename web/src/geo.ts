export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
