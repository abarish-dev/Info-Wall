// The exact flat JSON contract expected by the ESP32 firmware's C++ parser.
// Keys and data types must match precisely — do not nest or rename.

export type BlePayload = {
  radius: number; // number
  trackFlight: boolean; // boolean
  flightIdent: string; // string
  showWeather: boolean; // boolean
  lat: number; // number
  lon: number; // number
  team1: string; // string
  team2: string; // string
  tv1: string; // string
  tv2: string; // string
  tv3: string; // string
};

type SettingsShape = {
  searchRadius: number;
  trackFlight: boolean;
  flightIdent: string;
  showWeather: boolean;
  teams: string[];
  shows: string[];
};

export function buildBlePayload(
  s: SettingsShape,
  coords: { lat: number; lon: number } | null,
): BlePayload {
  const teams = s.teams.map((t) => t.trim());
  const shows = s.shows.map((v) => v.trim());
  return {
    radius: s.searchRadius,
    trackFlight: s.trackFlight,
    flightIdent: s.flightIdent.trim(),
    showWeather: s.showWeather,
    lat: coords?.lat ?? 0,
    lon: coords?.lon ?? 0,
    team1: teams[0] ?? "",
    team2: teams[1] ?? "",
    tv1: shows[0] ?? "",
    tv2: shows[1] ?? "",
    tv3: shows[2] ?? "",
  };
}
