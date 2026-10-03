// Control panel constants, types and helpers — extracted from index.tsx.
import { colors } from "@/src/theme";
import type { BleStatus } from "@/src/services/ble";

export const STORAGE_KEY = "matrix_settings_v2";
export const RECENT_ZIPS_KEY = "recent_zips_v1";
export const LAST_SYNC_KEY = "last_sync_v1";
export const PROFILES_KEY = "wall_profiles_v1";
export const ACTIVE_KEY = "active_wall_v1";
export const LAST_DEVICE_KEY = "last_device_v1";
export const THEME_KEY = "theme_id_v1";
export const SECTION_OPEN_KEY = "section_open_v1";
export const REMINDERS_KEY = "episode_reminders_v1";

export type SectionKey =
  | "flight"
  | "pinned"
  | "weather"
  | "planes"
  | "sports"
  | "tv"
  | "stocks"
  | "message"
  | "transitions"
  | "sync";

export const SECTION_DEFAULT_OPEN: Record<SectionKey, boolean> = {
  flight: true,
  pinned: false,
  weather: true,
  planes: false,
  sports: false,
  tv: false,
  stocks: false,
  message: false,
  transitions: false,
  sync: false,
};

export type Profile = {
  id: string;
  name: string;
  color?: string;
  settings: Settings;
};

export const PALETTE = [
  "#FF6B00",
  "#10B981",
  "#3B82F6",
  "#F59E0B",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
  "#EC4899",
];
export const HERO_IMAGE =
  "https://images.pexels.com/photos/29149453/pexels-photo-29149453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export const DEFAULTS = {
  wallName: "Info Wall",
  searchRadius: 3,
  trackFlight: false,
  flightIdent: "",
  showWeather: true,
  zipCode: "28117",
  trackingMode: "radius",
  polygon: [] as number[][],
  brightness: 80,
  pinned: false,
  stocks: ["AAPL", "MSFT", "", "", "", "", "", ""],
  showCustomMessage: false,
  msgLine1: "",
  msgLine2: "",
  msgLine3: "",
  scheduleEnabled: false,
  scheduleStart: "19:00",
  scheduleEnd: "07:00",
  scheduleBrightness: 40,
  teams: ["MLB:NYY", "NFL:CAR"],
  shows: ["Shrinking", "Emily in Paris", "Ted Lasso"],
  fadeSpeed: 5,
  holdSeconds: 12,
  showLKN: true,
  showFolly: true,
  showMarkets: false,
  showCountdown: true,
  countdownLabel: "",
  countdownDate: "",
};

export type Settings = {
  wallName: string;
  searchRadius: number;
  trackFlight: boolean;
  flightIdent: string;
  showWeather: boolean;
  zipCode: string;
  trackingMode: string;
  polygon: number[][];
  brightness: number;
  pinned: boolean;
  stocks: string[];
  showCustomMessage: boolean;
  msgLine1: string;
  msgLine2: string;
  msgLine3: string;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleBrightness: number;
  teams: string[];
  shows: string[];
  fadeSpeed: number;
  holdSeconds: number;
  showLKN: boolean;
  showFolly: boolean;
  showMarkets?: boolean;
  showCountdown: boolean;
  countdownLabel: string;
  countdownDate: string;
};

export const MAX_ROWS = 8;

export const STATUS_META: Record<
  BleStatus,
  { label: string; color: string }
> = {
  disconnected: { label: "DISCONNECTED", color: colors.error },
  scanning: { label: "SCANNING", color: colors.warning },
  connecting: { label: "CONNECTING", color: colors.warning },
  connected: { label: "CONNECTED", color: colors.success },
};

export function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  let rel: string;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 1440) rel = `${Math.round(mins / 60)}h ago`;
  else rel = `${Math.round(mins / 1440)}d ago`;
  const abs = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${abs} · ${rel}`;
}
