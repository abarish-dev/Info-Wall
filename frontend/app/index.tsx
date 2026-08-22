import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Switch,
  ScrollView,
  Modal,
  Linking,
  useWindowDimensions,
  PanResponder,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { useToast } from "@/src/components/Toast";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import {
  connectToMatrix,
  connectToKnownDevice,
  syncSettings,
  disconnect,
  isBleSupported,
  readRssi,
  flashTest,
  writeLive,
  BleError,
  type BleStatus,
} from "@/src/services/ble";
import { geocodeZip, type GeoResult } from "@/src/services/geocode";
import { buildBlePayload } from "@/src/services/payload";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import * as Clipboard from "expo-clipboard";

const STORAGE_KEY = "matrix_settings_v2";
const RECENT_ZIPS_KEY = "recent_zips_v1";
const LAST_SYNC_KEY = "last_sync_v1";
const PROFILES_KEY = "wall_profiles_v1";
const ACTIVE_KEY = "active_wall_v1";
const LAST_DEVICE_KEY = "last_device_v1";

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
  scheduleEnabled: false,
  scheduleStart: "19:00",
  scheduleEnd: "07:00",
  scheduleBrightness: 40,
  teams: ["NYY", "CAR"],
  shows: ["Shrinking", "Emily in Paris", "Ted Lasso"],
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
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleBrightness: number;
  teams: string[];
  shows: string[];
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
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const toast = useToast();

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
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
  const [lastSync, setLastSync] = useState<{
    at: string;
    summary: string;
  } | null>(null);

  const bleSupported = useMemo(() => isBleSupported(), []);

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
      writeLive({
        command: "teams",
        teams: settings.teams.map((x) => x.trim()).filter(Boolean),
      }).catch(() => {});
      writeLive({
        command: "shows",
        shows: settings.shows.map((x) => x.trim()).filter(Boolean),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [settings.teams, settings.shows, status]);

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

  const editList = (key: "teams" | "shows", i: number, val: string) =>
    setSettings((s) => {
      const arr = [...s[key]];
      arr[i] = val;
      return { ...s, [key]: arr };
    });
  const addRow = (key: "teams" | "shows") =>
    setSettings((s) =>
      s[key].length >= MAX_ROWS ? s : { ...s, [key]: [...s[key], ""] },
    );
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
      storage.removeItem(LAST_DEVICE_KEY);
      toast.show("Disconnected from matrix", "info");
      return;
    }

    try {
      const info = await connectToMatrix(setStatus, () => {
        setStatus("disconnected");
        setDevice(null);
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
      const msg =
        e instanceof BleError
          ? e.message
          : "Could not connect. Please try again.";
      toast.show(msg, "error");
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

  const handleSaveWifi = async (ssid: string, password: string) => {
    if (!isConnected) {
      toast.show("Connect to the matrix first", "error");
      return;
    }
    if (!ssid.trim()) {
      toast.show("Enter a Wi-Fi SSID", "error");
      return;
    }
    try {
      await writeLive({ command: "wifi", ssid: ssid.trim(), password });
      toast.show(
        "Wi-Fi credentials sent. Matrix is rebooting and connecting...",
        "success",
      );
    } catch {
      toast.show("Couldn't send Wi-Fi credentials", "error");
    }
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

      // Flat payload matching the ESP32 firmware contract exactly.
      const payload = buildBlePayload(settings, coords);

      const { confirmed } = await syncSettings(payload);
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
            <View style={styles.statusPill} testID="connection-status-pill">
              <View
                style={[styles.statusDot, { backgroundColor: statusMeta.color }]}
              />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>
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
          </View>

          <Text style={styles.heroSubtitle}>
            Configure and push live settings to your LED matrix.
          </Text>

          <Pressable
            testID="connect-button"
            onPress={handleConnect}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.connectBtn,
              isConnected && styles.connectBtnConnected,
              pressed && styles.pressed,
            ]}
          >
            {isBusy ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Ionicons
                name={isConnected ? "bluetooth" : "bluetooth-outline"}
                size={20}
                color={isConnected ? colors.success : colors.onBrand}
              />
            )}
            <Text
              style={[
                styles.connectBtnText,
                isConnected && styles.connectBtnTextConnected,
              ]}
            >
              {isConnected
                ? "DISCONNECT"
                : isBusy
                  ? statusMeta.label
                  : "CONNECT TO MATRIX"}
            </Text>
          </Pressable>

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
        {/* Flight Tracking */}
        <Section
          icon="airplane"
          title="FLIGHT TRACKING"
          subtitle="Show flights within range"
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
        </Section>

        {/* Sports */}
        <Section
          icon="american-football"
          title="SPORTS"
          subtitle="Track your teams"
        >
          {settings.teams.map((team, i) => (
            <AvatarInput
              key={`team-${i}`}
              testID={`team-${i + 1}-input`}
              label={`Team ${i + 1}`}
              value={team}
              placeholder="NYY"
              autoCapitalize="characters"
              maxLength={5}
              onChangeText={(t) => editList("teams", i, t)}
              onRemove={
                settings.teams.length > 1
                  ? () => removeRow("teams", i)
                  : undefined
              }
            />
          ))}
          <AddRowButton
            testID="add-team-button"
            label="Add Team"
            disabled={settings.teams.length >= MAX_ROWS}
            onPress={() => addRow("teams")}
          />
        </Section>

        {/* TV Shows */}
        <Section icon="tv" title="TV SHOWS" subtitle="Your watchlist">
          {settings.shows.map((show, i) => (
            <AvatarInput
              key={`show-${i}`}
              testID={`show-${i + 1}-input`}
              label={`Show ${i + 1}`}
              value={show}
              placeholder="Show name"
              onChangeText={(t) => editList("shows", i, t)}
              onRemove={
                settings.shows.length > 1
                  ? () => removeRow("shows", i)
                  : undefined
              }
            />
          ))}
          <AddRowButton
            testID="add-show-button"
            label="Add Show"
            disabled={settings.shows.length >= MAX_ROWS}
            onPress={() => addRow("shows")}
          />
        </Section>

        {/* Sync Status / History */}
        <Section
          icon="time"
          title="SYNC STATUS"
          subtitle="Last push to the matrix"
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
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Ionicons name="sync" size={20} color={colors.onBrand} />
            )}
            <Text style={styles.syncBtnText}>SYNC SETTINGS</Text>
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
        liveEnabled={isConnected}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function AvatarInput({
  label,
  value,
  placeholder,
  onChangeText,
  autoCapitalize,
  maxLength,
  testID,
  onRemove,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (t: string) => void;
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  maxLength?: number;
  testID: string;
  onRemove?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const initials = (value.trim() || placeholder)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || "--"}</Text>
        </View>
        <TextInput
          testID={testID}
          style={styles.input}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={colors.info}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
            Haptics.selectionAsync().catch(() => {});
          }}
          onBlur={() => setFocused(false)}
          autoCapitalize={autoCapitalize ?? "sentences"}
          maxLength={maxLength}
          autoCorrect={false}
          returnKeyType="done"
        />
        {onRemove && (
          <Pressable
            testID={`${testID}-remove`}
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => [
              styles.removeBtn,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="close" size={16} color={colors.info} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AddRowButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.addRow,
        pressed && styles.pressed,
        disabled && styles.addRowDisabled,
      ]}
    >
      <Ionicons name="add" size={18} color={colors.brand} />
      <Text style={styles.addRowText}>{label}</Text>
    </Pressable>
  );
}

function IconInput({
  label,
  value,
  placeholder,
  onChangeText,
  icon,
  keyboardType,
  maxLength,
  editable,
  autoCapitalize,
  testID,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (t: string) => void;
  icon: keyof typeof Ionicons.glyphMap;
  keyboardType?: "default" | "number-pad";
  maxLength?: number;
  editable?: boolean;
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  testID: string;
}) {
  const [focused, setFocused] = useState(false);
  const disabled = editable === false;
  return (
    <View style={[styles.field, disabled && styles.fieldDisabled]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        <View style={styles.avatar}>
          <Ionicons name={icon} size={18} color={colors.brand} />
        </View>
        <TextInput
          testID={testID}
          style={styles.input}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={colors.info}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
            Haptics.selectionAsync().catch(() => {});
          }}
          onBlur={() => setFocused(false)}
          keyboardType={keyboardType ?? "default"}
          maxLength={maxLength}
          editable={editable}
          autoCapitalize={autoCapitalize ?? "sentences"}
          autoCorrect={false}
          returnKeyType="done"
        />
      </View>
    </View>
  );
}

function signalColor(rssi: number | null): string {
  if (rssi == null) return colors.info;
  if (rssi >= -60) return colors.success;
  if (rssi >= -80) return colors.warning;
  return colors.error;
}

function PolyOverlay({
  lat,
  lon,
  zoom,
  size,
  polygon,
}: {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
  polygon: number[][];
}) {
  if (!polygon.length) return null;
  const z = zoom;
  const c = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(c.x);
  const yt = Math.floor(c.y);
  const S = size / 3;
  const pts = polygon.map(([vlat, vlon]) => {
    const p = lonLatToTileFrac(vlon, vlat, z);
    return { x: (p.x - (xt - 1)) * S, y: (p.y - (yt - 1)) * S };
  });
  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <Svg
      width={size}
      height={size}
      style={{ position: "absolute", left: 0, top: 0 }}
      pointerEvents="none"
    >
      {pts.length >= 2 && (
        <SvgPolygon
          points={pointsStr}
          fill="rgba(255,107,0,0.22)"
          stroke={colors.brand}
          strokeWidth={2}
        />
      )}
    </Svg>
  );
}

function VertexHandle({
  x,
  y,
  index,
  onMove,
  toLatLon,
}: {
  x: number;
  y: number;
  index: number;
  onMove: (i: number, lat: number, lon: number) => void;
  toLatLon: (px: number, py: number) => { lat: number; lon: number };
}) {
  const posRef = useRef({ x, y });
  posRef.current = { x, y };
  const startRef = useRef({ x, y });
  const cbRef = useRef({ onMove, toLatLon });
  cbRef.current = { onMove, toLatLon };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = posRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const nx = startRef.current.x + g.dx;
        const ny = startRef.current.y + g.dy;
        const { lat, lon } = cbRef.current.toLatLon(nx, ny);
        cbRef.current.onMove(index, lat, lon);
      },
    }),
  ).current;

  return (
    <View
      testID={`poly-vertex-${index}`}
      {...pan.panHandlers}
      style={{
        position: "absolute",
        left: x - 16,
        top: y - 16,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.brand,
          borderWidth: 2,
          borderColor: colors.onSurface,
        }}
      />
    </View>
  );
}

function PolyEditor({
  lat,
  lon,
  zoom,
  size,
  polygon,
  onMove,
}: {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
  polygon: number[][];
  onMove: (i: number, lat: number, lon: number) => void;
}) {
  const z = zoom;
  const n = Math.pow(2, z);
  const c = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(c.x);
  const yt = Math.floor(c.y);
  const S = size / 3;
  const toLatLon = (px: number, py: number) => {
    const tileX = xt - 1 + px / S;
    const tileY = yt - 1 + py / S;
    return {
      lon: (tileX / n) * 360 - 180,
      lat:
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) /
        Math.PI,
    };
  };
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    >
      {polygon.map(([vlat, vlon], i) => {
        const p = lonLatToTileFrac(vlon, vlat, z);
        const x = (p.x - (xt - 1)) * S;
        const y = (p.y - (yt - 1)) * S;
        return (
          <VertexHandle
            key={i}
            x={x}
            y={y}
            index={i}
            onMove={onMove}
            toLatLon={toLatLon}
          />
        );
      })}
    </View>
  );
}

// Renders a small OpenStreetMap tile grid (3x3) centered on lat/lon with an
// accurate pin. Uses raw OSM tiles (key-less) instead of a static-map service.
function lonLatToTileFrac(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function TileMap({
  lat,
  lon,
  size,
  zoom,
  radiusMiles,
  mapType,
}: {
  lat: number;
  lon: number;
  size: number;
  zoom: number;
  radiusMiles?: number;
  mapType?: "streets" | "satellite";
}) {
  const z = zoom;
  const { x, y } = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(x);
  const yt = Math.floor(y);
  const fracX = x - xt;
  const fracY = y - yt;
  const S = size / 3;

  const tileUrl = (tx: number, ty: number) =>
    mapType === "satellite"
      ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`
      : `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;

  const tiles: { i: number; j: number; uri: string }[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      tiles.push({ i, j, uri: tileUrl(xt - 1 + i, yt - 1 + j) });
    }
  }
  const markerLeft = S + fracX * S;
  const markerTop = S + fracY * S;

  // Radius circle: convert miles -> pixels at this zoom/latitude.
  const latRad = (lat * Math.PI) / 180;
  const metersPerPixel =
    (156543.03392 * Math.cos(latRad)) / Math.pow(2, z);
  const radiusPx =
    radiusMiles && metersPerPixel > 0
      ? (radiusMiles * 1609.34) / metersPerPixel
      : 0;

  return (
    <View
      testID="map-image"
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        overflow: "hidden",
        backgroundColor: colors.surfaceTertiary,
      }}
    >
      {tiles.map((t) => (
        <Image
          key={`${t.i}-${t.j}`}
          source={{ uri: t.uri }}
          style={{
            position: "absolute",
            left: t.i * S,
            top: t.j * S,
            width: S,
            height: S,
          }}
          contentFit="cover"
          transition={150}
        />
      ))}
      {radiusPx > 0 && (
        <View
          pointerEvents="none"
          testID="radius-overlay-circle"
          style={{
            position: "absolute",
            left: markerLeft - radiusPx,
            top: markerTop - radiusPx,
            width: radiusPx * 2,
            height: radiusPx * 2,
            borderRadius: radiusPx,
            backgroundColor: "rgba(255,107,0,0.22)",
            borderWidth: 2,
            borderColor: colors.brand,
          }}
        />
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: markerLeft,
          top: markerTop,
          transform: [{ translateX: -14 }, { translateY: -26 }],
        }}
      >
        <Ionicons name="location" size={28} color={colors.brand} />
      </View>
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

const styles = StyleSheet.create({
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
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  heroSubtitle: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  connectBtnConnected: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.success,
  },
  connectBtnText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 1.5,
  },
  connectBtnTextConnected: {
    color: colors.success,
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
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  syncBtnBusy: {
    opacity: 0.7,
  },
  syncBtnText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
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
