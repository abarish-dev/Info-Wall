import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Switch,
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
import {
  connectToMatrix,
  syncSettings,
  disconnect,
  isBleSupported,
  readRssi,
  flashTest,
  BleError,
  type BleStatus,
} from "@/src/services/ble";
import { geocodeZip, type Coords } from "@/src/services/geocode";

const STORAGE_KEY = "matrix_settings_v2";
const HERO_IMAGE =
  "https://images.pexels.com/photos/29149453/pexels-photo-29149453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const DEFAULTS = {
  searchRadius: 3,
  showWeather: true,
  zipCode: "28117",
  teams: ["NYY", "CAR"],
  shows: ["Shrinking", "Emily in Paris", "Ted Lasso"],
};

type Settings = {
  searchRadius: number;
  showWeather: boolean;
  zipCode: string;
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
  const toast = useToast();

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<BleStatus>("disconnected");
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<{
    name: string;
    rssi: number | null;
  } | null>(null);
  const [flashing, setFlashing] = useState(false);

  const bleSupported = useMemo(() => isBleSupported(), []);

  // Load persisted settings once (with migration from the old v1 format).
  useEffect(() => {
    (async () => {
      const saved = (await storage.getItem<any>(STORAGE_KEY, null)) as
        | Settings
        | null;
      if (saved && Array.isArray(saved.teams)) {
        setSettings({ ...DEFAULTS, ...saved });
      } else {
        const legacy = (await storage.getItem<any>(
          "matrix_settings_v1",
          null,
        )) as any;
        if (legacy && (legacy.team1 || legacy.show1)) {
          setSettings({
            searchRadius: legacy.searchRadius ?? DEFAULTS.searchRadius,
            teams: [legacy.team1, legacy.team2].filter(
              (x) => x != null,
            ) as string[],
            shows: [legacy.show1, legacy.show2, legacy.show3].filter(
              (x) => x != null,
            ) as string[],
          });
        }
      }
      setHydrated(true);
    })();
  }, []);

  // Persist whenever settings change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, settings);
  }, [settings, hydrated]);

  // Poll signal strength while connected.
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      const r = await readRssi();
      setDevice((d) => (d ? { ...d, rssi: r } : d));
    }, 5000);
    return () => clearInterval(id);
  }, [status]);

  const setRadius = (v: number) =>
    setSettings((s) => ({ ...s, searchRadius: v }));

  const setWeather = (v: boolean) =>
    setSettings((s) => ({ ...s, showWeather: v }));
  const setZip = (v: string) =>
    setSettings((s) => ({ ...s, zipCode: v.replace(/[^0-9]/g, "") }));

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

    if (!isConnected) {
      toast.show("Connect to the matrix first to sync", "error");
      return;
    }

    setBusy(true);
    try {
      const zip = settings.zipCode.trim();
      let coords: Coords | null = null;

      // When weather is enabled, resolve the zip to lat/lon before syncing.
      if (settings.showWeather) {
        if (zip.length !== 5) {
          toast.show("Enter a valid 5-digit zip code for weather", "error");
          setBusy(false);
          return;
        }
        coords = await geocodeZip(zip);
        if (!coords) {
          toast.show(
            "Couldn't find that zip code. Check it and try again.",
            "error",
          );
          setBusy(false);
          return;
        }
      }

      const payload = {
        flightTracking: { searchRadius: settings.searchRadius },
        weather: {
          showLocalWeather: settings.showWeather,
          zipCode: zip,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
        },
        sports: {
          teams: settings.teams.map((t) => t.trim()).filter(Boolean),
        },
        tvShows: settings.shows.map((s) => s.trim()).filter(Boolean),
        syncedAt: new Date().toISOString(),
      };

      const { confirmed } = await syncSettings(payload);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
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
            <View style={styles.logoBox}>
              <Ionicons name="grid" size={18} color={colors.brand} />
            </View>
            <Text style={styles.brandTitle}>MATRIX CONTROL</Text>

            <View style={styles.statusPill} testID="connection-status-pill">
              <View
                style={[styles.statusDot, { backgroundColor: statusMeta.color }]}
              />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>
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
            onSlidingComplete={() =>
              Haptics.selectionAsync().catch(() => {})
            }
            minimumTrackTintColor={colors.brand}
            maximumTrackTintColor={colors.surfaceTertiary}
            thumbTintColor={colors.brand}
          />
          <View style={styles.sliderScale}>
            <Text style={styles.scaleText}>1 mi</Text>
            <Text style={styles.scaleText}>50 mi</Text>
          </View>
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
  brandTitle: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.xl,
    letterSpacing: 1.5,
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
