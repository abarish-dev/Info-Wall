// Zip -> lat/lon lookup using the free, key-less Zippopotam.us public API.
// https://api.zippopotam.us/us/28117 -> { places: [{ latitude, longitude }] }

export type Coords = { lat: number; lon: number };

export async function geocodeZip(zip: string): Promise<Coords | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const data = await res.json();
    const place = data?.places?.[0];
    if (!place) return null;
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}
