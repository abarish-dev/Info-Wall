// The exact flat JSON contract expected by the ESP32 firmware's C++ parser.
// Keys and data types must match precisely — do not nest or rename.

export type BlePayload = {
  radius: number; // number
  trackFlight: boolean; // boolean
  flightIdent: string; // string
  showWeather: boolean; // boolean
  lat: number; // number
  lon: number; // number
  trackingMode: string; // "radius" | "polygon"
  polygon: number[][]; // [[lat,lon], ...]
  brightness: number; // number 0-100
  scheduleEnabled: boolean; // boolean
  scheduleStart: string; // "HH:MM"
  scheduleEnd: string; // "HH:MM"
  scheduleBrightness: number; // number 0-100 (0 = display off)
  team1: string;
  team2: string;
  team3: string;
  team4: string;
  team5: string;
  team6: string;
  team7: string;
  team8: string;
  tv1: string;
  tv2: string;
  tv3: string;
  tv4: string;
  tv5: string;
  tv6: string;
  tv7: string;
  tv8: string;
};

type SettingsShape = {
  searchRadius: number;
  trackFlight: boolean;
  flightIdent: string;
  showWeather: boolean;
  trackingMode: string;
  polygon: number[][];
  brightness: number;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleBrightness: number;
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
    trackingMode: s.trackingMode,
    polygon: s.polygon,
    brightness: s.brightness,
    scheduleEnabled: s.scheduleEnabled,
    scheduleStart: s.scheduleStart,
    scheduleEnd: s.scheduleEnd,
    scheduleBrightness: s.scheduleBrightness,
    team1: teams[0] ?? "",
    team2: teams[1] ?? "",
    team3: teams[2] ?? "",
    team4: teams[3] ?? "",
    team5: teams[4] ?? "",
    team6: teams[5] ?? "",
    team7: teams[6] ?? "",
    team8: teams[7] ?? "",
    tv1: shows[0] ?? "",
    tv2: shows[1] ?? "",
    tv3: shows[2] ?? "",
    tv4: shows[3] ?? "",
    tv5: shows[4] ?? "",
    tv6: shows[5] ?? "",
    tv7: shows[6] ?? "",
    tv8: shows[7] ?? "",
  };
}
