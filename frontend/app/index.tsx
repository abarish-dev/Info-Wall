import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Switch,
  ScrollView,
  Modal,
  Linking,
  useWindowDimensions,
  LayoutAnimation,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";

import {
  colors,
  spacing,
  radius,
  fonts,
  fontSize,
  applyAccent,
  ACCENTS,
  type AccentId,
} from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { useToast } from "@/src/components/Toast";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import {
  Section,
  TextField,
  IconInput,
} from "@/src/components/FormControls";
import {
  TileMap,
  PolyOverlay,
  PolyEditor,
  signalColor,
  lonLatToTileFrac,
} from "@/src/components/MatrixMap";
import { TransitionsSection } from "@/src/components/TransitionsSection";
import { TeamRows } from "@/src/components/TeamPicker";
import { ShowRows } from "@/src/components/ShowRows";
import { StockRows } from "@/src/components/StockRows";
import { useShowStatuses } from "@/src/hooks/useShowStatuses";
import { useTeamStatuses } from "@/src/hooks/useTeamStatuses";
import { findTeam } from "@/src/data/teams";
import type { Reminder } from "@/src/components/ShowRows";
import { PlanesOverhead } from "@/src/components/PlanesOverhead";
import {
  connectToKnownDevice,
  scanForDevices,
  disconnect,
  isBleSupported,
  readRssi,
  flashTest,
  writeLive,
  readSettings,
  monitorMatrix,
  stopMonitor,
  BleError,
  type BleStatus,
} from "@/src/services/ble";
import { geocodeZip, type GeoResult } from "@/src/services/geocode";
import { buildBlePayload } from "@/src/services/payload";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";

const STORAGE_KEY = "matrix_settings_v2";
const RECENT_ZIPS_KEY = "recent_zips_v1";
const LAST_SYNC_KEY = "last_sync_v1";
const PROFILES_KEY = "wall_profiles_v1";
const ACTIVE_KEY = "active_wall_v1";
const LAST_DEVICE_KEY = "last_device_v1";
const THEME_KEY = "theme_id_v1";
const SECTION_OPEN_KEY = "section_open_v1";
const REMINDERS_KEY = "episode_reminders_v1";

type SectionKey =
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

const SECTION_DEFAULT_OPEN: Record<SectionKey, boolean> = {
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

type Profile = {
  id: string;
  name: string;
  color?: string;
  settings: Settings;
};

const PALETTE = [
  "#FF6B00",
  "#10B981",
  "#3B82F6",
  "#F59E0B",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
  "#EC4899",
];
const HERO_IMAGE =
  "https://images.pexels.com/photos/29149453/pexels-photo-29149453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const DEFAULTS = {
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
  showCountdown: true,
  countdownLabel: "",
  countdownDate: "",
};

type Settings = {
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
  showCountdown: boolean;
  countdownLabel: string;
  countdownDate: string;
};

const MAX_ROWS = 8;

const STATUS_META: Record<
  BleStatus,
  { label: string; color: string }
> = {
  disconnected: { label: "DISCONNECTED", color: colors.error },
  scanning: { label: "SCANNING", color: colors.warning },
  connecting: { label: "CONNECTING", color: colors.warning },
  connected: { label: "CONNECTED", color: colors.success },
};

export default function ControlPanel() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const toast = useToast();
  const router = useRouter();

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const { statuses: showStatuses, newTodayCount } = useShowStatuses(
    settings.shows,
  );
  const { statuses: teamStatuses } = useTeamStatuses(settings.teams);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  // Load persisted episode reminders once.
  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<Reminder[]>(REMINDERS_KEY, []);
      if (Array.isArray(saved)) setReminders(saved);
    })();
  }, []);

  const reminderKeys = useMemo(
    () => new Set(reminders.map((r) => r.key)),
    [reminders],
  );
  const toggleReminder = (r: Reminder) => {
    Haptics.selectionAsync().catch(() => {});
    setReminders((prev) => {
      const exists = prev.some((x) => x.key === r.key);
      const next = exists
        ? prev.filter((x) => x.key !== r.key)
        : [...prev, r];
      storage.setItem(REMINDERS_KEY, next);
      return next;
    });
    toast.show(
      reminderKeys.has(r.key) ? "Reminder removed" : "We'll flag it on the wall",
      "info",
    );
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const remindersDueToday = reminders.filter((r) => r.airdate === todayIso);
  const [hydrated, setHydrated] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [status, setStatus] = useState<BleStatus>("disconnected");
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<{
    name: string;
    rssi: number | null;
  } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [geo, setGeo] = useState<GeoResult | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [recentZips, setRecentZips] = useState<string[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapZoom, setMapZoom] = useState(11);
  const [mapType, setMapType] = useState<"streets" | "satellite">("streets");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerDevices, setPickerDevices] = useState<
    { id: string; name: string }[]
  >([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastSsid, setLastSsid] = useState("");
  const [lastPass, setLastPass] = useState("");
  const [wifiStatus, setWifiStatus] = useState<{
    state: "idle" | "waiting" | "connected" | "failed" | "timeout";
    ip?: string;
  }>({ state: "idle" });
  // Cancels an in-flight Wi-Fi result poll when a new join starts / status set.
  const wifiPollRef = useRef(0);
  // Live Folly tides + Lake Norman readouts shown in the Weather section.
  const [follyData, setFollyData] = useState<{
    e?: { y: string; t: string; v: number }[];
    w?: number | null;
    dir?: "in" | "out" | null;
  } | null>(null);
  const [lakeData, setLakeData] = useState<{
    lvl?: number | null;
    full?: number | null;
    w?: number | null;
  } | null>(null);
  const [lastSync, setLastSync] = useState<{
    at: string;
    summary: string;
  } | null>(null);
  const [themeId, setThemeId] = useState<AccentId>("orange");
  // Symbols verified valid by StockRows — only these are pushed to the matrix.
  const [validStocks, setValidStocks] = useState<string[]>([]);
  const [stockQuotes, setStockQuotes] = useState<
    Record<string, { price: number | null; changePct: number | null }>
  >({});
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>(
    SECTION_DEFAULT_OPEN,
  );

  // Load persisted accordion open/closed state once.
  useEffect(() => {
    (async () => {
      const saved = (await storage.getItem<any>(
        SECTION_OPEN_KEY,
        null,
      )) as Partial<Record<SectionKey, boolean>> | null;
      if (saved && typeof saved === "object") {
        setSectionOpen({ ...SECTION_DEFAULT_OPEN, ...saved });
      }
    })();
  }, []);

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      storage.setItem(SECTION_OPEN_KEY, next);
      return next;
    });
  };

  const allExpanded = (Object.keys(SECTION_DEFAULT_OPEN) as SectionKey[]).every(
    (k) => sectionOpen[k],
  );

  const setAllSections = (openAll: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.selectionAsync().catch(() => {});
    const next = (Object.keys(SECTION_DEFAULT_OPEN) as SectionKey[]).reduce(
      (acc, k) => ({ ...acc, [k]: openAll }),
      {} as Record<SectionKey, boolean>,
    );
    setSectionOpen(next);
    storage.setItem(SECTION_OPEN_KEY, next);
  };

  const bleSupported = useMemo(() => isBleSupported(), []);

  // Load persisted accent theme once (applied before first meaningful paint;
  // the LED splash masks any brief default-accent flash on cold start).
  useEffect(() => {
    (async () => {
      const id = (await storage.getItem<AccentId>(
        THEME_KEY,
        "orange",
      )) as AccentId;
      if (id && ACCENTS[id]) {
        applyAccent(id);
        setThemeId(id);
      }
    })();
  }, []);

  const setTheme = (id: AccentId) => {
    applyAccent(id);
    setThemeId(id);
    storage.setItem(THEME_KEY, id);
    Haptics.selectionAsync().catch(() => {});
  };

  // Load wall profiles once (migrating any legacy single-settings blob).
  useEffect(() => {
    (async () => {
      const savedProfiles = (await storage.getItem<any>(
        PROFILES_KEY,
        null,
      )) as Profile[] | null;
      const savedActive = (await storage.getItem<any>(ACTIVE_KEY, null)) as
        | string
        | null;
      if (Array.isArray(savedProfiles) && savedProfiles.length) {
        const active =
          savedProfiles.find((p) => p.id === savedActive) ?? savedProfiles[0];
        setProfiles(savedProfiles);
        setActiveId(active.id);
        setSettings({ ...DEFAULTS, ...active.settings });
      } else {
        const legacy = (await storage.getItem<any>(
          STORAGE_KEY,
          null,
        )) as Settings | null;
        const base =
          legacy && Array.isArray(legacy.teams)
            ? { ...DEFAULTS, ...legacy }
            : DEFAULTS;
        const id = String(Date.now());
        const prof: Profile[] = [
          {
            id,
            name: base.wallName || "Info Wall",
            color: PALETTE[0],
            settings: base,
          },
        ];
        setProfiles(prof);
        setActiveId(id);
        setSettings(base);
        storage.setItem(PROFILES_KEY, prof);
        storage.setItem(ACTIVE_KEY, id);
      }
      setHydrated(true);
    })();
  }, []);

  // Persist active settings + mirror into its profile.
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, settings);
    setProfiles((prev) => {
      const next = prev.map((p) =>
        p.id === activeId
          ? { ...p, name: settings.wallName || p.name, settings }
          : p,
      );
      storage.setItem(PROFILES_KEY, next);
      return next;
    });
  }, [settings, hydrated, activeId]);

  // Auto-clear a travel countdown once the trip date has passed (checked on
  // launch and whenever the date changes) so old events never linger.
  useEffect(() => {
    if (!hydrated) return;
    const d = settings.countdownDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const target = new Date(d + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (days < 0) {
      setSettings((s) => ({ ...s, countdownDate: "", countdownLabel: "" }));
      toast.show("Travel countdown cleared — the trip has passed", "info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, settings.countdownDate]);

  // Load recent zips + last sync record once.
  useEffect(() => {
    (async () => {
      const rz = (await storage.getItem<any>(RECENT_ZIPS_KEY, null)) as
        | string[]
        | null;
      if (Array.isArray(rz)) setRecentZips(rz);
      const ls = (await storage.getItem<any>(LAST_SYNC_KEY, null)) as {
        at: string;
        summary: string;
      } | null;
      if (ls) setLastSync(ls);
    })();
  }, []);

  // Poll signal strength while connected.
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      const r = await readRssi();
      setDevice((d) => (d ? { ...d, rssi: r } : d));
    }, 5000);
    return () => clearInterval(id);
  }, [status]);

  // Auto-reconnect to the last known matrix on app open.
  const attemptReconnect = async () => {
    if (!bleSupported) return;
    const lastId = (await storage.getItem<any>(LAST_DEVICE_KEY, null)) as
      | string
      | null;
    if (!lastId) return;
    setReconnecting(true);
    setReconnectFailed(false);
    try {
      const info = await connectToKnownDevice(lastId, setStatus, () => {
        setStatus("disconnected");
        setDevice(null);
      });
      setDevice({ name: info.name, rssi: info.rssi });
      toast.show(`Reconnected to ${info.name}`, "success");
    } catch {
      setStatus("disconnected");
      setReconnectFailed(true);
    } finally {
      setReconnecting(false);
    }
  };

  useEffect(() => {
    attemptReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleSupported]);

  // Auto-push team/show edits live (debounced) so no manual Sync is needed.
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const activeTeams = settings.teams.map((x) => x.trim()).filter(Boolean);
      writeLive({
        command: "teams",
        teams: activeTeams,
        // Per-team colors so the panel can flash the right color on a score.
        colors: activeTeams.map((code) => {
          const [lg, ab] = code.split(":");
          return findTeam(lg as any, ab)?.color ?? "";
        }),
      }).catch(() => {});
      writeLive({
        command: "shows",
        shows: settings.shows.map((x) => x.trim()).filter(Boolean),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [settings.teams, settings.shows, status]);

  // Tell the panel our backend base URL so it can fetch live data itself over
  // Wi-Fi (scores, prices, weather, planes, TV) without the phone nearby.
  useEffect(() => {
    if (status !== "connected") return;
    const url = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    if (!url) return;
    const t = setTimeout(() => {
      writeLive({ command: "server", url }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [status]);

  // Live push of stock tickers (debounced) — only verified-valid symbols,
  // with current price + daily change so the matrix can render them.
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const cmd: Record<string, unknown> = { command: "stocks" };
      validStocks.forEach((s, i) => {
        cmd[`stock${i + 1}`] = s;
        const q = stockQuotes[s];
        if (q?.price != null) cmd[`price${i + 1}`] = q.price;
        if (q?.changePct != null) cmd[`chg${i + 1}`] = q.changePct;
      });
      writeLive(cmd).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [validStocks, stockQuotes, status]);

  // Live push of the custom 3-line message (debounced).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      writeLive({
        command: "message",
        showCustomMessage: settings.showCustomMessage,
        line1: settings.msgLine1.trim(),
        line2: settings.msgLine2.trim(),
        line3: settings.msgLine3.trim(),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [
    settings.showCustomMessage,
    settings.msgLine1,
    settings.msgLine2,
    settings.msgLine3,
    status,
  ]);

  // Live push of team scores (live/final today) so the matrix can show them.
  const scoreLabels = useMemo(
    () =>
      settings.teams
        .map((code) => teamStatuses[code.toUpperCase()])
        .filter(
          (s) =>
            s &&
            (s.highlight === "live" || s.highlight === "recent") &&
            s.label,
        )
        .map((s) => (s as (typeof teamStatuses)[string]).label as string),
    [settings.teams, teamStatuses],
  );
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const cmd: Record<string, unknown> = { command: "scores" };
      scoreLabels.forEach((l, i) => (cmd[`score${i + 1}`] = l));
      writeLive(cmd).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [scoreLabels, status]);

  // Live push of per-team details (record + next game + highlight) so the panel
  // shows the SPORTS frame details even when its own Wi-Fi fetch is down.
  // Order matches the teams array (teamN <-> firmware slot i).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const cmd: Record<string, unknown> = { command: "teamdetails" };
      settings.teams
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((code, i) => {
          const s = teamStatuses[code.toUpperCase()];
          cmd[`rec${i + 1}`] = s?.record ?? "";
          cmd[`lbl${i + 1}`] = s?.label ?? "";
          cmd[`hl${i + 1}`] = s?.highlight ?? "";
        });
      writeLive(cmd).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [teamStatuses, settings.teams, status]);

  // Live push of per-show schedule labels (next episode / season premiere).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const cmd: Record<string, unknown> = { command: "showdetails" };
      settings.shows
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((name, i) => {
          const s = showStatuses[name.toLowerCase()];
          cmd[`lbl${i + 1}`] = s?.label ?? "";
        });
      writeLive(cmd).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [showStatuses, settings.shows, status]);


  // Live push of episode reminders that are due today.
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      const cmd: Record<string, unknown> = { command: "reminders" };
      remindersDueToday.forEach((r, i) => (cmd[`reminder${i + 1}`] = r.label));
      writeLive(cmd).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindersDueToday.map((r) => r.key).join(","), status]);


  // Live push of flight-tracking config (debounced).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      writeLive({
        command: "flight",
        trackFlight: settings.trackFlight,
        flightIdent: settings.flightIdent.trim(),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [settings.trackFlight, settings.flightIdent, status]);

  // Live push of weather toggle + resolved coordinates, plus current
  // conditions fetched here so the panel shows weather even if its own HTTPS
  // fetch is unavailable (debounced).
  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    const pushWeather = async () => {
      const cmd: Record<string, unknown> = {
        command: "weather",
        showWeather: settings.showWeather,
        lat: geo?.lat ?? 0,
        lon: geo?.lon ?? 0,
      };
      if (settings.showWeather && geo?.lat != null && geo?.lon != null) {
        try {
          const r = await fetch(
            `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/weather/current?lat=${geo.lat}&lon=${geo.lon}`,
          );
          if (r.ok) {
            const w = await r.json();
            if (w?.temp != null) cmd.temp = w.temp;
            if (w?.hi != null) cmd.hi = w.hi;
            if (w?.lo != null) cmd.lo = w.lo;
            if (w?.text) cmd.text = w.text;
          }
        } catch {
          /* coords still pushed; panel can try its own fetch */
        }
      }
      if (!cancelled) writeLive(cmd).catch(() => {});
    };
    // Push once shortly after connect, then refresh every 10 min so the panel
    // never gets stuck on a stale temperature.
    const first = setTimeout(pushWeather, 800);
    const iv = setInterval(pushWeather, 600000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [settings.showWeather, geo, status]);

  // Live push of the tracking zone: radius mode vs polygon (debounced).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      writeLive({
        command: "zone",
        trackingMode: settings.trackingMode,
        polygon: settings.polygon,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [settings.trackingMode, settings.polygon, status]);

  // Fetch Folly Beach tides + Lake Norman level here and push over BLE, so the
  // panel shows real data even when its own HTTPS fetch is unavailable.
  useEffect(() => {
    if (status !== "connected") return;
    const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    let cancelled = false;
    const t = setTimeout(async () => {
      if (settings.showFolly) {
        try {
          const r = await fetch(`${base}/api/device/folly`);
          if (r.ok && !cancelled) {
            const d = await r.json();
            const ev = Array.isArray(d?.e) ? d.e : [];
            const line = (e: any) =>
              e ? `${e.y} ${e.t} ${e.v}ft` : "";
            if (!cancelled)
              await writeLive({
                command: "folly",
                l1: line(ev[0]),
                l2: line(ev[1]),
                w: d?.w ?? 0,
                dir: d?.dir ?? "",
              });
          }
        } catch {
          /* panel can try its own fetch */
        }
      }
      if (settings.showLKN) {
        try {
          const r = await fetch(`${base}/api/device/lake`);
          if (r.ok && !cancelled) {
            const d = await r.json();
            let full = "";
            if (d?.lvl != null && d?.full != null) {
              const diff = d.lvl - d.full;
              full = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`;
            }
            if (!cancelled)
              await writeLive({
                command: "lake",
                lvl: d?.lvl != null ? String(d.lvl) : "",
                full,
                w: d?.w ?? 0,
              });
          }
        } catch {
          /* panel can try its own fetch */
        }
      }
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [settings.showFolly, settings.showLKN, status]);

  // Fetch Folly tides for the in-app readout whenever the module is on.
  useEffect(() => {
    if (!settings.showFolly) {
      setFollyData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/device/folly`,
        );
        if (r.ok && !cancelled) setFollyData(await r.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.showFolly]);

  // Fetch Lake Norman level for the in-app readout whenever the module is on.
  useEffect(() => {
    if (!settings.showLKN) {
      setLakeData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/device/lake`,
        );
        if (r.ok && !cancelled) setLakeData(await r.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.showLKN]);

  // Push the nearest overhead flight to the panel so "flights within range"
  // shows on the matrix even if the panel's own fetch is unavailable. Refreshes
  // periodically while connected (planes move in and out of range).
  useEffect(() => {
    if (status !== "connected") return;
    if (geo?.lat == null || geo?.lon == null) return;
    const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    let cancelled = false;
    const pushNearest = async () => {
      try {
        const r = await fetch(
          `${base}/api/device/planes?lat=${geo.lat}&lon=${geo.lon}&radius=${settings.searchRadius}`,
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const p = Array.isArray(d?.p) ? d.p : [];
        const f = p[0];
        let line = "";
        if (f) {
          line = f.al || f.f || "";
          if (f.d != null) line += ` ${f.d}mi`;
        }
        if (!cancelled) await writeLive({ command: "planes", line });
      } catch {
        /* panel can try its own fetch */
      }
    };
    const first = setTimeout(pushNearest, 1000);
    const iv = setInterval(pushNearest, 60000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [status, geo, settings.searchRadius]);

  // Auto full-sync whenever the phone (re)connects, so the wall always matches
  // the app — even after edits made while disconnected.
  const prevStatusRef = useRef<BleStatus>(status);
  useEffect(() => {
    const was = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === "connected" && was !== "connected") {
      // Every setting re-pushes via the live-sync effects below (they depend on
      // `status`), so a single oversized flat write isn't needed here — just
      // note the reconnect.
      const rec = {
        at: new Date().toISOString(),
        summary: "Auto-synced on reconnect",
      };
      setLastSync(rec);
      storage.setItem(LAST_SYNC_KEY, rec);
      toast.show("Reconnected — wall re-synced", "success");
    }    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Persistent notification subscription while connected, so we never miss the
  // firmware's Wi-Fi result (it notifies ~15s after the join completes).
  useEffect(() => {
    if (status !== "connected") return;
    monitorMatrix((obj) => {
      const ws = obj?.wifiStatus ?? obj?.wifi_status;
      if (ws === "connected" || ws === true) {
        wifiPollRef.current++; // cancel any in-flight poll
        setWifiStatus({ state: "connected", ip: obj?.ip });
      } else if (ws === "failed" || ws === false) {
        wifiPollRef.current++;
        setWifiStatus({ state: "failed" });
      }
      // ws === "connecting" -> leave the "waiting" banner as is.
    });
    return () => stopMonitor();
  }, [status]);


  // Detect when a tracked team SCORES during a live game and flash the wall
  // with the team color + logo + "SCORE".
  const prevScoresRef = useRef<Record<string, number>>({});
  useEffect(() => {
    Object.values(teamStatuses).forEach((st) => {
      if (st.score == null) return;
      const prev = prevScoresRef.current[st.team];
      if (st.highlight === "live" && prev != null && st.score > prev) {
        const [league, abbr] = st.team.split(":");
        const team = findTeam(league as any, abbr);
        const color = team?.color ?? colors.brand;
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        toast.show(
          `${abbr} scored! ${st.score}-${st.oppScore ?? ""}`,
          "success",
        );
        if (status === "connected") {
          writeLive({
            command: "scoreflash",
            team: st.team,
            abbr,
            color,
          }).catch(() => {});
        }
      }
      prevScoresRef.current[st.team] = st.score;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamStatuses]);


  // Live push of display transitions + travel countdown (debounced).
  useEffect(() => {
    if (status !== "connected") return;
    const t = setTimeout(() => {
      writeLive({
        command: "transitions",
        fadeSpeed: Math.round(settings.fadeSpeed),
        holdDurationMs: Math.round(settings.holdSeconds * 1000),
        showLKN: settings.showLKN,
        showFolly: settings.showFolly,
        showCountdown: settings.showCountdown,
        countdownLabel: settings.countdownLabel.trim(),
        countdownDate: settings.countdownDate,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [
    settings.fadeSpeed,
    settings.holdSeconds,
    settings.showLKN,
    settings.showFolly,
    settings.showCountdown,
    settings.countdownLabel,
    settings.countdownDate,
    status,
  ]);


  // Load remembered Wi-Fi SSID + password (password kept in secure storage).
  useEffect(() => {
    (async () => {
      const s = (await storage.getItem<any>("last_ssid_v1", null)) as
        | string
        | null;
      if (s) setLastSsid(s);
      const p = (await storage.secureGet<any>("last_wifi_pass_v1", null)) as
        | string
        | null;
      if (p) setLastPass(p);
    })();
  }, []);

  const handleSaveWifi = async (ssid: string, password: string) => {
    if (!ssid.trim()) {
      toast.show("Enter a Wi-Fi SSID", "error");
      return;
    }
    // Remember the typed SSID + password immediately so they're never lost,
    // even if the matrix isn't connected yet. Password goes to secure storage.
    storage.setItem("last_ssid_v1", ssid.trim());
    setLastSsid(ssid.trim());
    storage.secureSet("last_wifi_pass_v1", password);
    setLastPass(password);
    if (!isConnected) {
      toast.show("Connect to the matrix first", "error");
      return;
    }
    try {
      await writeLive({ command: "wifi", ssid: ssid.trim(), password });
      setWifiStatus({ state: "waiting" });
      toast.show(
        "Wi-Fi credentials sent. Matrix is connecting...",
        "success",
      );
      // The persistent monitor catches the firmware's {"wifiStatus":...}
      // notification. But that live notification can be lost if the BLE link
      // blips when the Wi-Fi radio powers up, so ALSO poll the characteristic:
      // the firmware stores its latest Wi-Fi result on it, so a read reliably
      // returns the outcome. Poll every 2.5s for ~35s, then time out.
      const token = ++wifiPollRef.current;
      const startedAt = Date.now();
      const poll = async () => {
        if (wifiPollRef.current !== token) return; // superseded / resolved
        if (Date.now() - startedAt > 35000) {
          if (wifiPollRef.current === token) setWifiStatus({ state: "timeout" });
          return;
        }
        const rb: any = await readSettings();
        const ws = rb?.wifiStatus ?? rb?.wifi_status;
        if (ws === "connected" || ws === true) {
          wifiPollRef.current++;
          setWifiStatus({ state: "connected", ip: rb?.ip });
          return;
        }
        if (ws === "failed" || ws === false) {
          wifiPollRef.current++;
          setWifiStatus({ state: "failed" });
          return;
        }
        setTimeout(poll, 2500);
      };
      setTimeout(poll, 2500);
    } catch {
      setWifiStatus({ state: "idle" });
      toast.show("Couldn't send Wi-Fi credentials", "error");
    }
  };

  // Live zip -> coordinates lookup (debounced) for the preview under the field.
  useEffect(() => {
    const zip = settings.zipCode.trim();
    if (!settings.showWeather || zip.length !== 5) {
      setGeo(null);
      setGeoLoading(false);
      return;
    }
    let cancelled = false;
    setGeoLoading(true);
    const t = setTimeout(async () => {
      const res = await geocodeZip(zip);
      if (!cancelled) {
        setGeo(res);
        setGeoLoading(false);
        if (res) {
          setRecentZips((prev) => {
            const next = [zip, ...prev.filter((z) => z !== zip)].slice(0, 6);
            storage.setItem(RECENT_ZIPS_KEY, next);
            return next;
          });
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [settings.zipCode, settings.showWeather]);

  const setRadius = (v: number) =>
    setSettings((s) => ({ ...s, searchRadius: v }));
  const patchSettings = (p: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...p }));

  const switchProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    Haptics.selectionAsync().catch(() => {});
    setActiveId(id);
    setSettings({ ...DEFAULTS, ...p.settings });
    storage.setItem(ACTIVE_KEY, id);
  };
  const addProfile = () => {
    const id = String(Date.now());
    const base = { ...DEFAULTS, wallName: "New Wall" };
    const color = PALETTE[profiles.length % PALETTE.length];
    const next = [...profiles, { id, name: "New Wall", color, settings: base }];
    setProfiles(next);
    storage.setItem(PROFILES_KEY, next);
    setActiveId(id);
    setSettings(base);
    storage.setItem(ACTIVE_KEY, id);
    toast.show("New wall added", "success");
  };
  const duplicateProfile = () => {
    const active = profiles.find((p) => p.id === activeId);
    if (!active) return;
    const id = String(Date.now());
    const name = `${settings.wallName || active.name} Copy`;
    const base = { ...settings, wallName: name };
    const color = PALETTE[profiles.length % PALETTE.length];
    const next = [...profiles, { id, name, color, settings: base }];
    setProfiles(next);
    storage.setItem(PROFILES_KEY, next);
    setActiveId(id);
    setSettings(base);
    storage.setItem(ACTIVE_KEY, id);
    toast.show("Wall duplicated", "success");
  };
  const setProfileColor = (color: string) => {
    setProfiles((prev) => {
      const next = prev.map((p) =>
        p.id === activeId ? { ...p, color } : p,
      );
      storage.setItem(PROFILES_KEY, next);
      return next;
    });
    Haptics.selectionAsync().catch(() => {});
  };
  const movePolyPoint = (i: number, lat: number, lon: number) =>
    setSettings((s) => {
      const poly = [...s.polygon];
      poly[i] = [Number(lat.toFixed(5)), Number(lon.toFixed(5))];
      return { ...s, polygon: poly };
    });

  const deleteProfile = (id: string) => {
    if (profiles.length <= 1) {
      toast.show("Keep at least one wall", "error");
      return;
    }
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    storage.setItem(PROFILES_KEY, next);
    if (id === activeId) {
      const first = next[0];
      setActiveId(first.id);
      setSettings({ ...DEFAULTS, ...first.settings });
      storage.setItem(ACTIVE_KEY, first.id);
    }
    toast.show("Wall deleted", "info");
  };

  const setWeather = (v: boolean) =>
    setSettings((s) => ({ ...s, showWeather: v }));
  const setZip = (v: string) =>
    setSettings((s) => ({ ...s, zipCode: v.replace(/[^0-9]/g, "") }));
  const setTrackFlight = (v: boolean) =>
    setSettings((s) => ({ ...s, trackFlight: v }));
  const setFlightIdent = (v: string) =>
    setSettings((s) => ({
      ...s,
      flightIdent: v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),
    }));
  const removeRecentZip = (z: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRecentZips((prev) => {
      const next = prev.filter((x) => x !== z);
      storage.setItem(RECENT_ZIPS_KEY, next);
      return next;
    });
    toast.show(`Removed ${z} from recent`, "info");
  };

  const removeRow = (key: "teams" | "shows", i: number) =>
    setSettings((s) => ({
      ...s,
      [key]: s[key].filter((_, idx) => idx !== i),
    }));

  const isConnected = status === "connected";
  const isBusy = status === "scanning" || status === "connecting";

  const handleConnect = async () => {
    if (isBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (isConnected) {
      await disconnect();
      setStatus("disconnected");
      setDevice(null);
      setWifiStatus({ state: "idle" });
      storage.removeItem(LAST_DEVICE_KEY);
      toast.show("Disconnected from matrix", "info");
      return;
    }

    try {
      setStatus("scanning");
      const devices = await scanForDevices(4000);
      if (devices.length === 0) {
        setStatus("disconnected");
        toast.show("No Info Wall matrix found nearby", "error");
        return;
      }
      if (devices.length === 1) {
        await connectById(devices[0].id);
      } else {
        setPickerDevices(devices);
        setPickerOpen(true);
        setStatus("disconnected");
      }
    } catch (e) {
      setStatus("disconnected");
      setDevice(null);
      const msg =
        e instanceof BleError
          ? e.message
          : "Could not connect. Please try again.";
      toast.show(msg, "error");
    }
  };

  const connectById = async (id: string) => {
    setPickerOpen(false);
    try {
      const info = await connectToKnownDevice(id, setStatus, () => {
        setStatus("disconnected");
        setDevice(null);
        setWifiStatus({ state: "idle" });
        toast.show("Matrix disconnected", "error");
      });
      setDevice({ name: info.name, rssi: info.rssi });
      storage.setItem(LAST_DEVICE_KEY, info.id);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      toast.show(`Connected to ${info.name}`, "success");
    } catch (e) {
      setStatus("disconnected");
      setDevice(null);
      const msg = e instanceof BleError ? e.message : "Failed to connect.";
      toast.show(msg, "error");
    }
  };

  const setPinned = async (v: boolean) => {
    patchSettings({ pinned: v });
    if (!isConnected) return;
    try {
      await writeLive({ command: "pin", isPinned: v });
      toast.show(v ? "Screen pinned" : "Screen unpinned", "success");
    } catch {
      toast.show("Couldn't update pin state", "error");
    }
  };

  const openInMaps = () => {
    if (!geo) return;
    const url = `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=13/${geo.lat}/${geo.lon}`;
    Linking.openURL(url).catch(() => {});
  };

  const handleLiveBrightness = async (value: number) => {
    if (!isConnected) return;
    try {
      await writeLive({ command: "brightness", brightness: value });
      toast.show(`Brightness → ${value}%`, "success");
    } catch {
      toast.show("Couldn't update brightness live", "error");
    }
  };

  const handleLiveSchedule = async (sched: {
    scheduleEnabled: boolean;
    scheduleStart: string;
    scheduleEnd: string;
    scheduleBrightness: number;
  }) => {
    if (!isConnected) return;
    try {
      await writeLive({ command: "schedule", ...sched });
      toast.show("Schedule pushed to matrix", "success");
    } catch {
      toast.show("Couldn't update schedule live", "error");
    }
  };

  const handleLiveRadius = async (value: number) => {
    if (!isConnected) return;
    try {
      await writeLive({ command: "radius", radius: value });
      toast.show(`Radius → ${value} mi`, "success");
    } catch {
      toast.show("Couldn't update radius live", "error");
    }
  };

  const copyPayload = async () => {
    await Clipboard.setStringAsync(JSON.stringify(previewPayload, null, 2));
    Haptics.selectionAsync().catch(() => {});
    toast.show("Payload JSON copied", "success");
  };

  const handleFlash = async () => {
    if (flashing || !isConnected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setFlashing(true);
    try {
      await flashTest();
      toast.show("Flash pattern sent to matrix", "success");
    } catch (e) {
      const msg = e instanceof BleError ? e.message : "Flash test failed.";
      toast.show(msg, "error");
    } finally {
      setFlashing(false);
    }
  };

  const handleSync = async () => {
    if (busy) return;
    // Always persist locally.
    await storage.setItem(STORAGE_KEY, settings);

    // Guard: Track Flight on but no ident entered.
    if (settings.trackFlight && !settings.flightIdent.trim()) {
      toast.show(
        "Enter a flight number to track, or turn off Track Specific Flight",
        "error",
      );
      return;
    }

    if (!isConnected) {
      toast.show("Connect to the matrix first to sync", "error");
      return;
    }

    setBusy(true);
    try {
      const zip = settings.zipCode.trim();
      let coords: GeoResult | null = null;

      // Always convert the zip to numeric lat/lon via the geocoding API before
      // the Bluetooth write. When weather is on, a valid resolvable zip is
      // required; otherwise coordinates default to 0 in the payload.
      if (zip.length === 5) {
        coords = await geocodeZip(zip);
      }
      if (settings.showWeather && !coords) {
        toast.show(
          zip.length !== 5
            ? "Enter a valid 5-digit zip code for weather"
            : "Couldn't resolve that zip code. Check it and try again.",
          "error",
        );
        setBusy(false);
        return;
      }

      // A single flat write of every setting exceeds one BLE characteristic
      // write (MTU/attr limit) and fails. Instead send the full current state
      // as the same small, reliable per-command writes the live-sync uses.
      const activeTeams = settings.teams.map((x) => x.trim()).filter(Boolean);
      const stocksCmd: Record<string, unknown> = { command: "stocks" };
      validStocks.forEach((s, i) => {
        stocksCmd[`stock${i + 1}`] = s;
        const q = stockQuotes[s];
        if (q?.price != null) stocksCmd[`price${i + 1}`] = q.price;
        if (q?.changePct != null) stocksCmd[`chg${i + 1}`] = q.changePct;
      });
      const commands: Record<string, unknown>[] = [
        { command: "server", url: process.env.EXPO_PUBLIC_BACKEND_URL ?? "" },
        { command: "radius", radius: settings.searchRadius },
        { command: "brightness", brightness: settings.brightness },
        {
          command: "schedule",
          scheduleEnabled: settings.scheduleEnabled,
          scheduleStart: settings.scheduleStart,
          scheduleEnd: settings.scheduleEnd,
          scheduleBrightness: settings.scheduleBrightness,
        },
        {
          command: "flight",
          trackFlight: settings.trackFlight,
          flightIdent: settings.flightIdent.trim(),
        },
        {
          command: "weather",
          showWeather: settings.showWeather,
          lat: coords?.lat ?? 0,
          lon: coords?.lon ?? 0,
        },
        {
          command: "zone",
          trackingMode: settings.trackingMode,
          polygon: settings.polygon,
        },
        {
          command: "teams",
          teams: activeTeams,
          colors: activeTeams.map((code) => {
            const [lg, ab] = code.split(":");
            return findTeam(lg as any, ab)?.color ?? "";
          }),
        },
        {
          command: "shows",
          shows: settings.shows.map((x) => x.trim()).filter(Boolean),
        },
        stocksCmd,
        {
          command: "message",
          showCustomMessage: settings.showCustomMessage,
          line1: settings.msgLine1.trim(),
          line2: settings.msgLine2.trim(),
          line3: settings.msgLine3.trim(),
        },
        {
          command: "transitions",
          fadeSpeed: Math.round(settings.fadeSpeed),
          holdDurationMs: Math.round(settings.holdSeconds * 1000),
          showLKN: settings.showLKN,
          showFolly: settings.showFolly,
          showCountdown: settings.showCountdown,
          countdownLabel: settings.countdownLabel.trim(),
          countdownDate: settings.countdownDate,
        },
      ];

      let sent = 0;
      for (const c of commands) {
        try {
          await writeLive(c);
          sent++;
          await new Promise((r) => setTimeout(r, 60));
        } catch {
          // One failed command shouldn't abort the whole sync.
        }
      }
      if (sent === 0) {
        throw new BleError("SYNC_FAILED", "Sync failed. Please try again.");
      }
      const confirmed = sent === commands.length;

      const payload = buildBlePayload(settings, coords);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});

      const nowIso = new Date().toISOString();
      const teamCount = [
        payload.team1, payload.team2, payload.team3, payload.team4,
        payload.team5, payload.team6, payload.team7, payload.team8,
      ].filter(Boolean).length;
      const showCount = [
        payload.tv1, payload.tv2, payload.tv3, payload.tv4,
        payload.tv5, payload.tv6, payload.tv7, payload.tv8,
      ].filter(Boolean).length;
      const summary =
        `${payload.radius} mi · ${teamCount} teams · ${showCount} shows · ` +
        `${payload.showWeather ? `wx ${payload.lat.toFixed(2)},${payload.lon.toFixed(2)}` : "wx off"} · ` +
        `${payload.trackFlight && payload.flightIdent ? `flight ${payload.flightIdent}` : "no flight"}`;
      const record = { at: nowIso, summary };
      setLastSync(record);
      storage.setItem(LAST_SYNC_KEY, record);

      toast.show(
        confirmed
          ? "Settings applied — confirmed by matrix"
          : "Settings sent (matrix didn't confirm read-back)",
        confirmed ? "success" : "info",
      );
    } catch (e) {
      const msg =
        e instanceof BleError ? e.message : "Sync failed. Please try again.";
      toast.show(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const statusMeta = STATUS_META[status];
  const zipTrimmed = settings.zipCode.trim();
  const zipInvalid = zipTrimmed.length > 0 && zipTrimmed.length !== 5;
  const zipComplete = zipTrimmed.length === 5;
  const previewPayload = buildBlePayload(settings, geo);
  const flightMissing = settings.trackFlight && !settings.flightIdent.trim();
  const mapSize = Math.min(winW - spacing.lg * 4, 360);
  const polyMode = settings.trackingMode === "polygon";
  const activeColor =
    profiles.find((p) => p.id === activeId)?.color ?? colors.brand;

  const handleMapPress = (e: any) => {
    if (!polyMode || !geo) return;
    const lx = e.nativeEvent?.locationX ?? 0;
    const ly = e.nativeEvent?.locationY ?? 0;
    const z = mapZoom;
    const n = Math.pow(2, z);
    const c = lonLatToTileFrac(geo.lon, geo.lat, z);
    const xt = Math.floor(c.x);
    const yt = Math.floor(c.y);
    const S = mapSize / 3;
    const tileX = xt - 1 + lx / S;
    const tileY = yt - 1 + ly / S;
    const lon = (tileX / n) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI;
    patchSettings({
      polygon: [
        ...settings.polygon,
        [Number(lat.toFixed(5)), Number(lon.toFixed(5))],
      ],
    });
  };

  return (
    <View style={styles.root}>
      {/* ---------- HERO / HEADER ---------- */}
      <View style={styles.hero}>
        <Image
          source={{ uri: HERO_IMAGE }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
        <LinearGradient
          colors={["rgba(18,18,18,0.55)", "rgba(18,18,18,0.85)", colors.surface]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.heroContent, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.brandRow}>
            <View style={[styles.logoBox, { borderColor: activeColor }]}>
              <Ionicons name="grid" size={18} color={activeColor} />
            </View>
            <Text style={styles.brandTitle} numberOfLines={1}>
              {(settings.wallName || "Info Wall").toUpperCase()}
            </Text>
            {newTodayCount + remindersDueToday.length > 0 && (
              <Pressable
                testID="new-episode-badge"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSectionOpen((prev) => {
                    const next = { ...prev, tv: true };
                    storage.setItem(SECTION_OPEN_KEY, next);
                    return next;
                  });
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.newBadge,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="tv" size={12} color={colors.onBrand} />
                <Text style={styles.newBadgeText}>
                  {newTodayCount + remindersDueToday.length} new
                </Text>
              </Pressable>
            )}
            <Pressable
              testID="preview-button"
              onPress={() => router.push("/matrix-preview")}
              hitSlop={8}
              style={({ pressed }) => [styles.gearBtn, pressed && styles.pressed]}
            >
              <Ionicons name="tv-outline" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable
              testID="settings-button"
              onPress={() => setSettingsOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.gearBtn, pressed && styles.pressed]}
            >
              <Ionicons name="settings-sharp" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            <Pressable
              testID="connect-button"
              onPress={handleConnect}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.statusPill,
                isConnected && styles.statusPillConnected,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={styles.statusPillInner}
                testID="connection-status-pill"
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color={statusMeta.color} />
                ) : (
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusMeta.color },
                    ]}
                  />
                )}
                <Text style={[styles.statusText, { color: statusMeta.color }]}>
                  {statusMeta.label}
                </Text>
              </View>
              <View style={styles.statusDivider} />
              <Ionicons
                name={isConnected ? "bluetooth" : "bluetooth-outline"}
                size={13}
                color={isConnected ? colors.success : colors.brand}
              />
              <Text
                style={[
                  styles.statusAction,
                  { color: isConnected ? colors.success : colors.brand },
                ]}
              >
                {isConnected
                  ? "TAP TO DISCONNECT"
                  : isBusy
                    ? "…"
                    : "TAP TO CONNECT"}
              </Text>
            </Pressable>
            {reconnecting && (
              <View style={styles.reconnectBanner} testID="reconnect-banner">
                <ActivityIndicator size="small" color={colors.brand} />
                <Text style={styles.reconnectText}>
                  Reconnecting to last matrix…
                </Text>
              </View>
            )}
            {!reconnecting && reconnectFailed && (
              <Pressable
                testID="reconnect-retry"
                onPress={attemptReconnect}
                style={({ pressed }) => [
                  styles.reconnectBanner,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="refresh"
                  size={13}
                  color={colors.warning}
                />
                <Text style={[styles.reconnectText, { color: colors.warning }]}>
                  Reconnect failed · Retry
                </Text>
              </Pressable>
            )}
            <View style={styles.pinPill}>
              <Ionicons
                name={settings.pinned ? "lock-closed" : "lock-open"}
                size={13}
                color={settings.pinned ? colors.brand : colors.info}
              />
              <Text style={styles.pinLabel}>PIN</Text>
              <Switch
                testID="pin-toggle"
                value={settings.pinned}
                onValueChange={setPinned}
                trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
                thumbColor={colors.onSurface}
                ios_backgroundColor={colors.surfaceTertiary}
                style={{ transform: [{ scale: 0.75 }] }}
              />
            </View>

          </View>

          {!bleSupported && !isConnected && (
            <Text style={styles.bleHint} testID="ble-unsupported-hint">
              Bluetooth needs a real device build — it won&apos;t connect in
              Expo Go or web preview.
            </Text>
          )}

          {isConnected && device && (
            <View style={styles.deviceRow} testID="device-info">
              <View style={styles.deviceLeft}>
                <Ionicons
                  name="hardware-chip"
                  size={16}
                  color={colors.success}
                />
                <Text style={styles.deviceName} numberOfLines={1}>
                  {device.name}
                </Text>
              </View>
              <View style={styles.signalWrap}>
                <Ionicons
                  name="cellular"
                  size={14}
                  color={signalColor(device.rssi)}
                />
                <Text
                  style={[styles.signalText, { color: signalColor(device.rssi) }]}
                >
                  {device.rssi != null ? `${device.rssi} dBm` : "-- dBm"}
                </Text>
              </View>
            </View>
          )}

          {isConnected && (
            <Pressable
              testID="flash-test-button"
              onPress={handleFlash}
              disabled={flashing}
              style={({ pressed }) => [
                styles.flashBtn,
                pressed && styles.pressed,
              ]}
            >
              {flashing ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Ionicons name="flash" size={18} color={colors.brand} />
              )}
              <Text style={styles.flashBtnText}>FLASH TEST PATTERN</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ---------- FORM ---------- */}
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 120 + insets.bottom },
        ]}
        bottomOffset={90}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Expand / Collapse all */}
        <Pressable
          testID="toggle-all-sections"
          onPress={() => setAllSections(!allExpanded)}
          style={({ pressed }) => [
            styles.toggleAllBtn,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={allExpanded ? "contract" : "expand"}
            size={15}
            color={colors.brand}
          />
          <Text style={styles.toggleAllText}>
            {allExpanded ? "COLLAPSE ALL" : "EXPAND ALL"}
          </Text>
        </Pressable>

        {/* Flight Tracking */}
        <Section
          icon="airplane"
          title="FLIGHT TRACKING"
          subtitle="Show flights within range"
          open={sectionOpen.flight}
          onToggle={() => toggleSection("flight")}
        >
          <View style={styles.radiusHeader}>
            <Text style={styles.fieldLabel}>Search Radius</Text>
            <Text style={styles.radiusValue} testID="radius-value">
              {settings.searchRadius} MI
            </Text>
          </View>
          <Slider
            testID="radius-slider"
            style={styles.slider}
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={settings.searchRadius}
            onValueChange={(v) => setRadius(Math.round(v))}
            onSlidingComplete={(v) => {
              Haptics.selectionAsync().catch(() => {});
              handleLiveRadius(Math.round(v));
            }}
            minimumTrackTintColor={colors.brand}
            maximumTrackTintColor={colors.surfaceTertiary}
            thumbTintColor={colors.brand}
          />
          <View style={styles.sliderScale}>
            <Text style={styles.scaleText}>1 mi</Text>
            <Text style={styles.scaleText}>50 mi</Text>
          </View>
        </Section>

        {/* Pinned Flight */}
        <Section
          icon="navigate"
          title="PINNED FLIGHT"
          subtitle="Follow one flight live"
          open={sectionOpen.pinned}
          onToggle={() => toggleSection("pinned")}
        >
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.fieldLabel}>Track Specific Flight</Text>
              <Text style={styles.toggleHint}>
                Pin a single flight by its ident
              </Text>
            </View>
            <Switch
              testID="track-flight-toggle"
              value={settings.trackFlight}
              onValueChange={setTrackFlight}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor={colors.onSurface}
              ios_backgroundColor={colors.surfaceTertiary}
            />
          </View>
          <IconInput
            testID="flight-ident-input"
            label="Flight Number / Ident"
            icon="airplane"
            value={settings.flightIdent}
            placeholder="AA1234 or DAL520"
            autoCapitalize="characters"
            maxLength={8}
            editable={settings.trackFlight}
            onChangeText={setFlightIdent}
          />
          {flightMissing && (
            <View style={styles.zipNoteRow} testID="flight-validation-warning">
              <Ionicons
                name="alert-circle"
                size={14}
                color={colors.warning}
              />
              <Text style={[styles.zipNoteText, { color: colors.warning }]}>
                Enter a flight number, or turn off Track Specific Flight
              </Text>
            </View>
          )}
        </Section>

        {/* Weather */}
        <Section
          icon="partly-sunny"
          title="WEATHER"
          subtitle="Local conditions"
          open={sectionOpen.weather}
          onToggle={() => toggleSection("weather")}
        >
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.fieldLabel}>Show Local Weather</Text>
              <Text style={styles.toggleHint}>
                Display current conditions on the matrix
              </Text>
            </View>
            <Switch
              testID="weather-toggle"
              value={settings.showWeather}
              onValueChange={setWeather}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor={colors.onSurface}
              ios_backgroundColor={colors.surfaceTertiary}
            />
          </View>
          <IconInput
            testID="zip-code-input"
            label="Zip Code"
            icon="location"
            value={settings.zipCode}
            placeholder="28117"
            keyboardType="number-pad"
            maxLength={5}
            editable={settings.showWeather}
            onChangeText={setZip}
          />

          {settings.showWeather && zipInvalid && (
            <View style={styles.zipNoteRow} testID="zip-validation-warning">
              <Ionicons
                name="alert-circle"
                size={14}
                color={colors.warning}
              />
              <Text style={[styles.zipNoteText, { color: colors.warning }]}>
                Zip code must be exactly 5 digits
              </Text>
            </View>
          )}

          {settings.showWeather && zipComplete && geoLoading && (
            <View style={styles.zipNoteRow} testID="coord-resolving">
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.zipNoteText}>Resolving location…</Text>
            </View>
          )}

          {settings.showWeather && zipComplete && !geoLoading && geo && (
            <Pressable
              testID="coord-preview"
              onPress={() => setMapOpen(true)}
              style={({ pressed }) => [
                styles.coordPreview,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="navigate" size={16} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.coordCity} numberOfLines={1}>
                  {geo.city}
                  {geo.state ? `, ${geo.state}` : ""}
                  {geo.cached ? "  (cached)" : ""}
                </Text>
                <Text style={styles.coordText} testID="coord-latlon">
                  {geo.lat.toFixed(4)}, {geo.lon.toFixed(4)}
                </Text>
              </View>
              <Ionicons name="map" size={18} color={colors.info} />
            </Pressable>
          )}

          {settings.showWeather && zipComplete && !geoLoading && !geo && (
            <View style={styles.zipNoteRow} testID="coord-error">
              <Ionicons name="close-circle" size={14} color={colors.error} />
              <Text style={[styles.zipNoteText, { color: colors.error }]}>
                Couldn&apos;t resolve this zip code
              </Text>
            </View>
          )}

          {settings.showWeather && recentZips.length > 0 && (
            <View style={styles.recentWrap}>
              <Text style={styles.recentLabel}>RECENT · HOLD TO REMOVE</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRow}
                keyboardShouldPersistTaps="handled"
              >
                {recentZips.map((z) => {
                  const active = z === zipTrimmed;
                  return (
                    <Pressable
                      key={z}
                      testID={`recent-zip-${z}`}
                      onPress={() => setZip(z)}
                      onLongPress={() => removeRecentZip(z)}
                      delayLongPress={350}
                      style={[
                        styles.recentChip,
                        active && styles.recentChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.recentChipText,
                          active && styles.recentChipTextActive,
                        ]}
                      >
                        {z}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.divider} />
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.fieldLabel}>Lake Norman Level</Text>
              <Text style={styles.toggleHint}>
                Duke Energy lake level + water temp
              </Text>
            </View>
            <Switch
              testID="toggle-lkn"
              value={settings.showLKN}
              onValueChange={(v) => setSettings((s) => ({ ...s, showLKN: v }))}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor={colors.onSurface}
              ios_backgroundColor={colors.surfaceTertiary}
            />
          </View>
          {settings.showLKN && lakeData?.lvl != null && (
            <View style={styles.dataReadout} testID="lake-readout">
              <Ionicons name="boat" size={16} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.readoutMain}>
                  {lakeData.lvl} ft
                  {lakeData.full != null
                    ? `  ·  ${lakeData.lvl - lakeData.full >= 0 ? "+" : ""}${(
                        lakeData.lvl - lakeData.full
                      ).toFixed(1)} ft vs full`
                    : ""}
                </Text>
                {lakeData.w != null && lakeData.w > 0 && (
                  <Text style={styles.readoutSub}>
                    Water {lakeData.w}°F
                  </Text>
                )}
              </View>
            </View>
          )}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.fieldLabel}>Folly Beach Tides</Text>
              <Text style={styles.toggleHint}>
                Next high/low tide at Hwy 171 bridge
              </Text>
            </View>
            <Switch
              testID="toggle-folly"
              value={settings.showFolly}
              onValueChange={(v) => setSettings((s) => ({ ...s, showFolly: v }))}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor={colors.onSurface}
              ios_backgroundColor={colors.surfaceTertiary}
            />
          </View>
          {settings.showFolly &&
            Array.isArray(follyData?.e) &&
            follyData.e.length > 0 && (
              <View style={styles.dataReadout} testID="folly-readout">
                <Ionicons name="water" size={16} color={colors.brand} />
              <View style={{ flex: 1 }}>
                {follyData.dir && (
                  <Text style={styles.readoutMain}>
                    {follyData.dir === "in"
                      ? "▲ Incoming tide"
                      : "▼ Outgoing tide"}
                  </Text>
                )}
                {follyData.e.slice(0, 2).map((ev, i) => (
                  <Text key={i} style={styles.readoutSub}>
                    {ev.y === "H" ? "High" : "Low"} {ev.t}  ·  {ev.v} ft
                  </Text>
                ))}
                {follyData.w != null && follyData.w > 0 && (
                  <Text style={styles.readoutSub}>Water {follyData.w}°F</Text>
                )}
              </View>
              </View>
            )}
        </Section>

        {/* Planes Overhead */}
        <PlanesOverhead
          lat={geo?.lat ?? null}
          lon={geo?.lon ?? null}
          radiusMiles={settings.searchRadius}
          locationLabel={geo ? `${geo.city}${geo.state ? `, ${geo.state}` : ""}` : undefined}
          open={sectionOpen.planes}
          onToggle={() => toggleSection("planes")}
        />

        {/* Sports */}
        <Section
          icon="american-football"
          title="SPORTS"
          subtitle="Track your teams"
          open={sectionOpen.sports}
          onToggle={() => toggleSection("sports")}
        >
          <TeamRows
            teams={settings.teams}
            max={MAX_ROWS}
            statuses={teamStatuses}
            onRemove={(i) => removeRow("teams", i)}
            onAdd={(value) =>
              setSettings((s) =>
                s.teams.includes(value) || s.teams.length >= MAX_ROWS
                  ? s
                  : { ...s, teams: [...s.teams, value] },
              )
            }
          />
        </Section>

        {/* TV Shows */}
        <Section
          icon="tv"
          title="TV SHOWS"
          subtitle="New-episode alerts"
          open={sectionOpen.tv}
          onToggle={() => toggleSection("tv")}
        >
          <ShowRows
            shows={settings.shows}
            max={MAX_ROWS}
            statuses={showStatuses}
            reminderKeys={reminderKeys}
            onToggleReminder={toggleReminder}
            onRemove={(i) => removeRow("shows", i)}
            onAdd={(name) =>
              setSettings((s) =>
                s.shows.some((n) => n.toLowerCase() === name.toLowerCase()) ||
                s.shows.length >= MAX_ROWS
                  ? s
                  : { ...s, shows: [...s.shows, name] },
              )
            }
          />
        </Section>

        {/* Financial Tickers */}
        <Section
          icon="trending-up"
          title="FINANCIAL TICKERS"
          subtitle="Up to 8 verified symbols"
          open={sectionOpen.stocks}
          onToggle={() => toggleSection("stocks")}
        >
          <StockRows
            stocks={settings.stocks}
            onChange={(next) => setSettings((s) => ({ ...s, stocks: next }))}
            onValidChange={setValidStocks}
            onQuotes={setStockQuotes}
          />
        </Section>

        {/* Custom Message */}
        <Section
          icon="chatbox-ellipses"
          title="CUSTOM MESSAGE"
          subtitle="Show a 3-line note on the matrix"
          open={sectionOpen.message}
          onToggle={() => toggleSection("message")}
        >
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.fieldLabel}>Show Custom Message</Text>
              <Text style={styles.toggleHint}>
                Overrides other content while on
              </Text>
            </View>
            <Switch
              testID="message-toggle"
              value={settings.showCustomMessage}
              onValueChange={(v) => patchSettings({ showCustomMessage: v })}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
              thumbColor={colors.onSurface}
              ios_backgroundColor={colors.surfaceTertiary}
            />
          </View>
          <TextField
            testID="msg-line-1-input"
            label="Line 1"
            value={settings.msgLine1}
            placeholder="Happy Birthday"
            onChangeText={(t) => patchSettings({ msgLine1: t })}
          />
          <TextField
            testID="msg-line-2-input"
            label="Line 2"
            value={settings.msgLine2}
            placeholder="Kimberley"
            onChangeText={(t) => patchSettings({ msgLine2: t })}
          />
          <TextField
            testID="msg-line-3-input"
            label="Line 3"
            value={settings.msgLine3}
            placeholder="Love, Adam"
            onChangeText={(t) => patchSettings({ msgLine3: t })}
          />
        </Section>

        <TransitionsSection
          fadeSpeed={settings.fadeSpeed}
          holdSeconds={settings.holdSeconds}
          showCountdown={settings.showCountdown}
          countdownLabel={settings.countdownLabel}
          countdownDate={settings.countdownDate}
          onChange={patchSettings}
          open={sectionOpen.transitions}
          onToggle={() => toggleSection("transitions")}
        />

        {/* Sync Status / History */}
        <Section
          icon="time"
          title="SYNC STATUS"
          subtitle="Last push to the matrix"
          open={sectionOpen.sync}
          onToggle={() => toggleSection("sync")}
        >
          {lastSync ? (
            <View style={styles.syncHistory} testID="sync-history">
              <View style={styles.syncTimeRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={colors.success}
                />
                <Text style={styles.syncTime}>
                  {formatSyncTime(lastSync.at)}
                </Text>
              </View>
              <Text style={styles.syncSummary}>{lastSync.summary}</Text>
            </View>
          ) : (
            <Text style={styles.syncEmpty} testID="sync-history-empty">
              No settings synced yet. Connect and tap Sync Settings.
            </Text>
          )}

          <View style={styles.payloadBlock}>
            <View style={styles.payloadHeader}>
              <Text style={styles.payloadLabel}>PAYLOAD PREVIEW (JSON)</Text>
              <Pressable
                testID="copy-payload-button"
                onPress={copyPayload}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.copyBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="copy-outline" size={14} color={colors.brand} />
                <Text style={styles.copyBtnText}>COPY</Text>
              </Pressable>
            </View>
            <Text style={styles.payloadJson} testID="payload-preview">
              {JSON.stringify(previewPayload, null, 2)}
            </Text>
          </View>
        </Section>
      </KeyboardAwareScrollView>

      {/* ---------- STICKY SYNC ---------- */}
      <KeyboardStickyView>
        <View
          style={[
            styles.syncBar,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Pressable
            testID="sync-settings-button"
            onPress={handleSync}
            disabled={busy}
            style={({ pressed }) => [
              styles.syncBtn,
              pressed && styles.pressed,
              busy && styles.syncBtnBusy,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Ionicons name="sync" size={18} color={colors.brand} />
            )}
            <Text style={styles.syncBtnText}>SYNC &amp; CONFIRM</Text>
          </Pressable>
        </View>
      </KeyboardStickyView>

      {/* Map Peek */}
      <Modal
        visible={mapOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMapOpen(false)}
      >
        <Pressable
          style={styles.mapBackdrop}
          onPress={() => setMapOpen(false)}
          testID="map-backdrop"
        >
          <Pressable
            style={[styles.mapCard, { paddingBottom: insets.bottom + spacing.lg }]}
            onPress={() => {}}
          >
            <View style={styles.mapHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mapTitle} numberOfLines={1}>
                  {geo?.city}
                  {geo?.state ? `, ${geo.state}` : ""}
                </Text>
                <Text style={styles.mapSub}>
                  {geo ? `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}` : ""}
                  {settings.zipCode ? ` · ${settings.zipCode}` : ""}
                </Text>
              </View>
              <Pressable
                testID="map-close"
                onPress={() => setMapOpen(false)}
                hitSlop={8}
                style={styles.mapCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.onSurface} />
              </Pressable>
            </View>

            {geo && (
              <View style={styles.mapImageWrap}>
                <View style={{ width: mapSize, height: mapSize }}>
                  <Pressable onPress={handleMapPress} disabled={!polyMode}>
                    <TileMap
                      lat={geo.lat}
                      lon={geo.lon}
                      size={mapSize}
                      zoom={mapZoom}
                      radiusMiles={polyMode ? undefined : settings.searchRadius}
                      mapType={mapType}
                    />
                  </Pressable>
                  <PolyOverlay
                    lat={geo.lat}
                    lon={geo.lon}
                    zoom={mapZoom}
                    size={mapSize}
                    polygon={settings.polygon}
                  />
                  {polyMode && (
                    <PolyEditor
                      lat={geo.lat}
                      lon={geo.lon}
                      zoom={mapZoom}
                      size={mapSize}
                      polygon={settings.polygon}
                      onMove={movePolyPoint}
                    />
                  )}
                  <View style={styles.zoomControls}>
                    <Pressable
                      testID="map-zoom-in"
                      onPress={() => setMapZoom((z) => Math.min(15, z + 1))}
                      style={({ pressed }) => [
                        styles.zoomBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name="add" size={22} color={colors.onSurface} />
                    </Pressable>
                    <Pressable
                      testID="map-zoom-out"
                      onPress={() => setMapZoom((z) => Math.max(8, z - 1))}
                      style={({ pressed }) => [
                        styles.zoomBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="remove"
                        size={22}
                        color={colors.onSurface}
                      />
                    </Pressable>
                  </View>
                  <Pressable
                    testID="map-type-toggle"
                    onPress={() =>
                      setMapType((t) =>
                        t === "streets" ? "satellite" : "streets",
                      )
                    }
                    style={({ pressed }) => [
                      styles.mapTypeBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={mapType === "streets" ? "globe" : "map"}
                      size={16}
                      color={colors.onSurface}
                    />
                    <Text style={styles.mapTypeText}>
                      {mapType === "streets" ? "SATELLITE" : "STREETS"}
                    </Text>
                  </Pressable>
                  <View style={styles.radiusOverlay}>
                    <View style={styles.modeRow}>
                      <Pressable
                        testID="mode-radius"
                        onPress={() => patchSettings({ trackingMode: "radius" })}
                        style={[
                          styles.modeChip,
                          !polyMode && styles.modeChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeChipText,
                            !polyMode && styles.modeChipTextActive,
                          ]}
                        >
                          RADIUS
                        </Text>
                      </Pressable>
                      <Pressable
                        testID="mode-polygon"
                        onPress={() =>
                          patchSettings({ trackingMode: "polygon" })
                        }
                        style={[
                          styles.modeChip,
                          polyMode && styles.modeChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeChipText,
                            polyMode && styles.modeChipTextActive,
                          ]}
                        >
                          POLYGON
                        </Text>
                      </Pressable>
                    </View>
                    {polyMode ? (
                      <View style={styles.polyRow}>
                        <Text style={styles.radiusOverlayLabel}>
                          {settings.polygon.length === 0
                            ? "Tap map to add points"
                            : `Polygon: ${settings.polygon.length} pts`}
                        </Text>
                      <View style={styles.polyBtnRow}>
                        <Pressable
                          testID="poly-undo"
                          onPress={() =>
                            patchSettings({
                              polygon: settings.polygon.slice(0, -1),
                            })
                          }
                          disabled={settings.polygon.length === 0}
                          style={({ pressed }) => [
                            styles.polyClearBtn,
                            pressed && styles.pressed,
                            settings.polygon.length === 0 && { opacity: 0.4 },
                          ]}
                        >
                          <Ionicons
                            name="arrow-undo"
                            size={14}
                            color={colors.brand}
                          />
                          <Text style={styles.polyClearText}>UNDO</Text>
                        </Pressable>
                        <Pressable
                          testID="poly-clear"
                          onPress={() => patchSettings({ polygon: [] })}
                          disabled={settings.polygon.length === 0}
                          style={({ pressed }) => [
                            styles.polyClearBtn,
                            pressed && styles.pressed,
                            settings.polygon.length === 0 && { opacity: 0.4 },
                          ]}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={14}
                            color={colors.brand}
                          />
                          <Text style={styles.polyClearText}>CLEAR</Text>
                        </Pressable>
                      </View>
                      </View>
                    ) : (
                      <>
                        <Text style={styles.radiusOverlayLabel}>
                          Radius: {settings.searchRadius} mi
                        </Text>
                        <Slider
                          testID="map-radius-slider"
                          style={{ width: "100%", height: 32 }}
                          minimumValue={1}
                          maximumValue={50}
                          step={1}
                          value={settings.searchRadius}
                          onValueChange={(v) => setRadius(Math.round(v))}
                          onSlidingComplete={(v) =>
                            handleLiveRadius(Math.round(v))
                          }
                          minimumTrackTintColor={colors.brand}
                          maximumTrackTintColor="rgba(255,255,255,0.35)"
                          thumbTintColor={colors.brand}
                        />
                      </>
                    )}
                  </View>
                </View>
              </View>
            )}
            <Text style={styles.mapAttribution}>Map data © OpenStreetMap</Text>

            <Pressable
              testID="open-in-maps"
              onPress={openInMaps}
              style={({ pressed }) => [
                styles.mapOpenBtn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="open-outline" size={18} color={colors.onBrand} />
              <Text style={styles.mapOpenText}>OPEN IN MAPS</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        wallName={settings.wallName}
        profiles={profiles.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
        }))}
        activeId={activeId}
        activeColor={activeColor}
        palette={PALETTE}
        onSwitchProfile={switchProfile}
        onAddProfile={addProfile}
        onDuplicateProfile={duplicateProfile}
        onDeleteProfile={deleteProfile}
        onSetColor={setProfileColor}
        brightness={settings.brightness}
        scheduleEnabled={settings.scheduleEnabled}
        scheduleStart={settings.scheduleStart}
        scheduleEnd={settings.scheduleEnd}
        scheduleBrightness={settings.scheduleBrightness}
        onChange={patchSettings}
        onLiveBrightness={handleLiveBrightness}
        onLiveSchedule={handleLiveSchedule}
        onSaveWifi={handleSaveWifi}
        initialSsid={lastSsid}
        initialPassword={lastPass}
        liveEnabled={isConnected}
        bleName={device?.name}
        wifiStatus={wifiStatus}
        themeId={themeId}
        onSetTheme={setTheme}
      />

      {/* Device picker (multiple FlightWall- boards nearby) */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.mapBackdrop}
          onPress={() => setPickerOpen(false)}
          testID="picker-backdrop"
        >
          <Pressable
            style={[styles.mapCard, { paddingBottom: insets.bottom + spacing.lg }]}
            onPress={() => {}}
          >
            <View style={styles.mapHeader}>
              <Text style={styles.mapTitle}>CHOOSE A MATRIX</Text>
              <Pressable
                testID="picker-close"
                onPress={() => setPickerOpen(false)}
                hitSlop={8}
                style={styles.mapCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
            {pickerDevices.map((d) => (
              <Pressable
                key={d.id}
                testID={`picker-device-${d.id}`}
                onPress={() => connectById(d.id)}
                style={({ pressed }) => [
                  styles.deviceRow,
                  pressed && styles.pressed,
                  { marginTop: 0 },
                ]}
              >
                <View style={styles.deviceLeft}>
                  <Ionicons
                    name="hardware-chip"
                    size={16}
                    color={colors.brand}
                  />
                  <Text style={styles.deviceName}>{d.name}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.info}
                />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function formatSyncTime(iso: string): string {
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

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const makeStyles = () =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  hero: {
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  logoBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  gearBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  newBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    marginRight: spacing.xs,
  },
  newBadgeText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    letterSpacing: 0.5,
  },
  zoomControls: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    gap: spacing.sm,
  },
  zoomBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,18,18,0.85)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusOverlay: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: "rgba(18,18,18,0.82)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusOverlayLabel: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modeChip: {
    flex: 1,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brand,
  },
  modeChipText: {
    color: colors.info,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  modeChipTextActive: {
    color: colors.brand,
  },
  polyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  polyBtnRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  polyClearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  polyClearText: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: 11,
    letterSpacing: 1,
  },
  brandTitle: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.xl,
    letterSpacing: 1.5,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reconnectText: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
  },
  pinPill: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    paddingLeft: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pinLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusPillConnected: {
    borderColor: colors.success,
  },
  statusPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDivider: {
    width: 1,
    height: 12,
    backgroundColor: colors.border,
    marginHorizontal: 2,
  },
  statusAction: {
    fontFamily: fonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1,
  },
  bleHint: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.85,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  toggleAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.lg,
  },
  toggleAllText: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 1.2,
  },
  sectionSubtitle: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  sectionBody: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  radiusValue: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize["2xl"],
    letterSpacing: 1,
  },
  slider: {
    width: "100%",
    height: 36,
  },
  sliderScale: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  scaleText: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
  },
  field: {
    gap: spacing.sm,
  },
  fieldDisabled: {
    opacity: 0.45,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  dataReadout: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  readoutMain: {
    color: colors.onSurface,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.md,
  },
  readoutSub: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  zipNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: -spacing.sm,
  },
  zipNoteText: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
  },
  coordPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: -spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
  },
  coordCity: {
    color: colors.onSurface,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
  },
  coordText: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.display,
    fontSize: fontSize.base,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  recentWrap: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  recentLabel: {
    color: colors.info,
    fontFamily: fonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  recentRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  recentChip: {
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentChipActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brand,
  },
  recentChipText: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.base,
    letterSpacing: 0.5,
  },
  recentChipTextActive: {
    color: colors.brand,
  },
  syncHistory: {
    gap: spacing.xs,
  },
  syncTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  syncTime: {
    color: colors.onSurface,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
  },
  syncSummary: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  syncEmpty: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
  },
  payloadBlock: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  payloadHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  copyBtnText: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: 11,
    letterSpacing: 1,
  },
  mapTypeBtn: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(18,18,18,0.85)",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    height: 34,
  },
  mapTypeText: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: 11,
    letterSpacing: 1,
  },
  payloadLabel: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  payloadJson: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  mapBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  mapCard: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  mapTitle: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.xl,
    letterSpacing: 0.5,
  },
  mapSub: {
    color: colors.info,
    fontFamily: fonts.mono,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  mapCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  mapImageWrap: {
    alignItems: "center",
  },
  mapAttribution: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: 10,
    textAlign: "right",
    marginTop: -spacing.xs,
  },
  mapOpenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  mapOpenText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 1.2,
  },
  fieldLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  inputRowFocused: {
    borderColor: colors.borderStrong,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.base,
    letterSpacing: 0.5,
  },
  warnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xs,
    paddingLeft: 2,
  },
  warnText: {
    color: colors.warning,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    paddingVertical: spacing.sm,
  },
  syncBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  syncBtnBusy: {
    opacity: 0.7,
  },
  syncBtnText: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.base,
    letterSpacing: 1.5,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deviceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  deviceName: {
    color: colors.onSurface,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
    flexShrink: 1,
  },
  signalWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  signalText: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    letterSpacing: 0.5,
  },
  flashBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  flashBtnText: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.base,
    letterSpacing: 1.2,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  addRowDisabled: {
    opacity: 0.4,
  },
  addRowText: {
    color: colors.brand,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
  },
  });
