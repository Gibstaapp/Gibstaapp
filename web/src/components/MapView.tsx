import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import type { PricedItem, UserProfile } from '@gib/shared';

/** One dot per store, colored by how cheap its best item is (green = cheapest). */
export default function MapView({ items, profile }: { items: PricedItem[]; profile: UserProfile }) {
  const bestByStore = new Map<string, { item: PricedItem; count: number }>();
  for (const it of items) {
    const cur = bestByStore.get(it.store.id);
    if (!cur) bestByStore.set(it.store.id, { item: it, count: 1 });
    else cur.count++;
  }
  const entries = [...bestByStore.values()];
  const prices = entries.map((e) => e.item.perUnit);
  const min = Math.min(...prices), max = Math.max(...prices);
  const color = (v: number) => {
    const t = max === min ? 0 : (v - min) / (max - min);
    const hue = 130 - t * 120; // green -> red
    return `hsl(${hue} 80% 50%)`;
  };

  return (
    <div className="h-[calc(100vh-13rem)] m-3 rounded-2xl overflow-hidden border border-zinc-800">
      <MapContainer center={[profile.lat, profile.lng]} zoom={11} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker center={[profile.lat, profile.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }}>
          <Popup>Home ({profile.homeZip})</Popup>
        </CircleMarker>
        {entries.filter((e) => e.item.store.lat && e.item.store.lng).map(({ item, count }) => (
          <CircleMarker key={item.store.id} center={[item.store.lat, item.store.lng]} radius={10}
            pathOptions={{ color: '#000', weight: 1, fillColor: color(item.perUnit), fillOpacity: 0.9 }}>
            <Popup>
              <div className="text-sm">
                <strong>{item.store.name}</strong><br />
                Best: {item.product.name}<br />
                ${item.perUnit.toFixed(2)}{item.unitLabel} · ${item.otd.toFixed(2)} OTD<br />
                {item.deal ? <em>{item.deal.title}</em> : 'No deal'}<br />
                {count} item{count > 1 ? 's' : ''} in this category
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
