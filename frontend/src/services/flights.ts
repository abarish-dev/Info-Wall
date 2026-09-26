// Live nearby-aircraft feed. Calls our FastAPI proxy (which fronts adsb.lol and
// resolves airline logos) so it works on device and web without CORS issues.

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type NearbyFlight = {
  hex: string | null;
  callsign: string;
  registration: string | null;
  type: string | null;
  altitude: number | null; // feet
  speed: number | null; // knots
  lat: number | null;
  lon: number | null;
  distance: number | null; // nautical miles from center
  direction: number | null; // bearing degrees
  airline: string | null;
  iata: string | null;
  logo: string | null;
};

export async function fetchNearbyFlights(
  lat: number,
  lon: number,
  radiusMiles: number,
): Promise<NearbyFlight[]> {
  const url = `${BASE}/api/flights/nearby?lat=${lat}&lon=${lon}&radius=${radiusMiles}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Flight feed unavailable");
  const data = await res.json();
  return (data?.flights ?? []) as NearbyFlight[];
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function bearingToCompass(deg: number | null): string {
  if (deg == null || Number.isNaN(deg)) return "";
  return COMPASS[Math.round(((deg % 360) / 22.5)) % 16];
}

export function nmToMiles(nm: number | null): number | null {
  if (nm == null) return null;
  return nm * 1.15078;
}
