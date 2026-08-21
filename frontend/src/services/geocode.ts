// Zip -> lat/lon lookup using the free, key-less Zippopotam.us public API.
// https://api.zippopotam.us/us/28117 -> { places: [{ latitude, longitude }] }
// Results are cached locally so a sync can still proceed if the lookup
// service is briefly unreachable.

import { storage } from "@/src/utils/storage";

export type Coords = {
  lat: number;
  lon: number;
  city: string;
  state: string;
};

export type GeoResult = Coords & { cached: boolean };

const CACHE_KEY = "geocode_cache_v1";

async function readCache(): Promise<Record<string, Coords>> {
  const raw = (await storage.getItem<any>(CACHE_KEY, null)) as
    | Record<string, Coords>
    | null;
  return raw ?? {};
}

async function writeCache(zip: string, coords: Coords): Promise<void> {
  const cache = await readCache();
  cache[zip] = coords;
  await storage.setItem(CACHE_KEY, cache as any);
}

export async function getCachedZip(zip: string): Promise<Coords | null> {
  const cache = await readCache();
  return cache[zip] ?? null;
}

export async function geocodeZip(zip: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (res.ok) {
      const data = await res.json();
      const place = data?.places?.[0];
      if (place) {
        const lat = parseFloat(place.latitude);
        const lon = parseFloat(place.longitude);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const coords: Coords = {
            lat,
            lon,
            city: place["place name"] ?? "",
            state: place["state abbreviation"] ?? place.state ?? "",
          };
          await writeCache(zip, coords);
          return { ...coords, cached: false };
        }
      }
    }
  } catch {
    // network error -> fall through to cache below
  }
  const cached = await getCachedZip(zip);
  return cached ? { ...cached, cached: true } : null;
}
