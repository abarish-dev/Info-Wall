// Display settings screen (opened behind the gear icon): screen brightness +
// an evening "Display schedule" that dims or blacks out the matrix during a
// settable time range. State is owned by the main screen and passed in.

import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

export type DisplayPatch = {
  wallName?: string;
  brightness?: number;
  scheduleEnabled?: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  scheduleBrightness?: number;
};

function addMinutes(hhmm: string, delta: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = ((h * 60 + m + delta) % 1440 + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function TimeStepper({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
}) {
  const bump = (delta: number) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(addMinutes(value, delta));
  };
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          testID={`${testID}-minus`}
          onPress={() => bump(-30)}
          hitSlop={6}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
        >
          <Ionicons name="remove" size={18} color={colors.brand} />
        </Pressable>
        <Text style={styles.timeValue} testID={`${testID}-value`}>
          {value}
        </Text>
        <Pressable
          testID={`${testID}-plus`}
          onPress={() => bump(30)}
          hitSlop={6}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  );
}

export function SettingsSheet({
  visible,
  onClose,
  wallName,
  profiles,
  activeId,
  activeColor,
  palette,
  onSwitchProfile,
  onAddProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onSetColor,
  brightness,
  scheduleEnabled,
  scheduleStart,
  scheduleEnd,
  scheduleBrightness,
  onChange,
  onLiveBrightness,
  onLiveSchedule,
  onSaveWifi,
  initialSsid,
  liveEnabled,
  wifiStatus,
}: {
  visible: boolean;
  onClose: () => void;
  wallName: string;
  profiles: { id: string; name: string; color?: string }[];
  activeId: string;
  activeColor: string;
  palette: string[];
  onSwitchProfile: (id: string) => void;
  onAddProfile: () => void;
  onDuplicateProfile: () => void;
  onDeleteProfile: (id: string) => void;
  onSetColor: (color: string) => void;
  brightness: number;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleBrightness: number;
  onChange: (patch: DisplayPatch) => void;
  onLiveBrightness?: (value: number) => void;
  onLiveSchedule?: (sched: {
    scheduleEnabled: boolean;
    scheduleStart: string;
    scheduleEnd: string;
    scheduleBrightness: number;
  }) => void;
  onSaveWifi?: (ssid: string, password: string) => void;
  initialSsid?: string;
  liveEnabled?: boolean;
  wifiStatus?: {
    state: "idle" | "waiting" | "connected" | "failed";
    ip?: string;
  };
}) {
  const insets = useSafeAreaInsets();
  const [wifiSsid, setWifiSsid] = useState(initialSsid ?? "");
  const [wifiPassword, setWifiPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const dimLabel =
    scheduleBrightness === 0 ? "Display off" : `Dimmed to ${scheduleBrightness}%`;

  const pushSchedule = (override: {
    enabled?: boolean;
    start?: string;
    end?: string;
    brightness?: number;
  }) => {
    onLiveSchedule?.({
      scheduleEnabled: override.enabled ?? scheduleEnabled,
      scheduleStart: override.start ?? scheduleStart,
      scheduleEnd: override.end ?? scheduleEnd,
      scheduleBrightness: override.brightness ?? scheduleBrightness,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>DISPLAY SETTINGS</Text>
          <Pressable
            testID="settings-close"
            onPress={onClose}
            hitSlop={8}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Wall profiles */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>WALL PROFILES</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.profileRow}
              keyboardShouldPersistTaps="handled"
            >
              {profiles.map((p) => {
                const active = p.id === activeId;
                return (
                  <Pressable
                    key={p.id}
                    testID={`profile-${p.id}`}
                    onPress={() => onSwitchProfile(p.id)}
                    onLongPress={() => onDeleteProfile(p.id)}
                    delayLongPress={400}
                    style={[
                      styles.profileChip,
                      active && styles.profileChipActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.profileDot,
                        { backgroundColor: p.color ?? colors.brand },
                      ]}
                    />
                    <Text
                      style={[
                        styles.profileChipText,
                        active && styles.profileChipTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {p.name || "Wall"}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                testID="duplicate-profile-button"
                onPress={onDuplicateProfile}
                style={[styles.profileChip, styles.addProfileChip]}
              >
                <Ionicons name="copy-outline" size={15} color={colors.brand} />
                <Text style={styles.profileChipTextActive}>Duplicate</Text>
              </Pressable>
              <Pressable
                testID="add-profile-button"
                onPress={onAddProfile}
                style={[styles.profileChip, styles.addProfileChip]}
              >
                <Ionicons name="add" size={16} color={colors.brand} />
                <Text style={styles.profileChipTextActive}>Add</Text>
              </Pressable>
            </ScrollView>
            <Text style={styles.hint}>Tap to switch · hold to delete</Text>
            <View style={styles.swatchRow}>
              {palette.map((col) => (
                <Pressable
                  key={col}
                  testID={`swatch-${col}`}
                  onPress={() => onSetColor(col)}
                  style={[
                    styles.swatch,
                    { backgroundColor: col },
                    activeColor === col && styles.swatchActive,
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Wall name */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>WALL NAME</Text>
            <TextInput
              testID="wall-name-input"
              style={styles.nameInput}
              value={wallName}
              onChangeText={(t) => onChange({ wallName: t.slice(0, 24) })}
              placeholder="Info Wall"
              placeholderTextColor={colors.info}
              maxLength={24}
              returnKeyType="done"
            />
            <Text style={styles.hint}>Shown at the top of the app.</Text>
          </View>

          {/* Brightness */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>BRIGHTNESS</Text>
              <Text style={styles.valueBadge}>{brightness}%</Text>
            </View>
            <Slider
              testID="brightness-slider"
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={brightness}
              onValueChange={(v) => onChange({ brightness: Math.round(v) })}
              onSlidingComplete={(v) => {
                Haptics.selectionAsync().catch(() => {});
                onLiveBrightness?.(Math.round(v));
              }}
              minimumTrackTintColor={colors.brand}
              maximumTrackTintColor={colors.surfaceTertiary}
              thumbTintColor={colors.brand}
            />
            <View style={styles.liveRow}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: liveEnabled ? colors.success : colors.info },
                ]}
              />
              <Text style={styles.hint}>
                {liveEnabled
                  ? "Live — changes push to the matrix instantly"
                  : "Connect to push brightness live (saved & synced otherwise)"}
              </Text>
            </View>
          </View>

          {/* Display schedule */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={styles.sectionTitle}>DISPLAY SCHEDULE</Text>
                <Text style={styles.hint}>
                  Dim or turn the display off during set hours
                </Text>
              </View>
              <Pressable
                testID="schedule-toggle"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  const next = !scheduleEnabled;
                  onChange({ scheduleEnabled: next });
                  pushSchedule({ enabled: next });
                }}
                style={[
                  styles.switchTrack,
                  scheduleEnabled && styles.switchTrackOn,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    scheduleEnabled && styles.switchThumbOn,
                  ]}
                />
              </Pressable>
            </View>

            {scheduleEnabled && (
              <View style={{ gap: spacing.lg, marginTop: spacing.md }}>
                <TimeStepper
                  testID="schedule-start"
                  label="Start"
                  value={scheduleStart}
                  onChange={(v) => {
                    onChange({ scheduleStart: v });
                    pushSchedule({ start: v });
                  }}
                />
                <TimeStepper
                  testID="schedule-end"
                  label="End"
                  value={scheduleEnd}
                  onChange={(v) => {
                    onChange({ scheduleEnd: v });
                    pushSchedule({ end: v });
                  }}
                />
                <View style={styles.divider} />
                <View style={styles.rowBetween}>
                  <Text style={styles.timeLabel}>Brightness during schedule</Text>
                  <Text style={styles.valueBadge}>{dimLabel}</Text>
                </View>
                <Slider
                  testID="schedule-brightness-slider"
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={100}
                  step={1}
                  value={scheduleBrightness}
                  onValueChange={(v) =>
                    onChange({ scheduleBrightness: Math.round(v) })
                  }
                  onSlidingComplete={(v) => {
                    Haptics.selectionAsync().catch(() => {});
                    pushSchedule({ brightness: Math.round(v) });
                  }}
                  minimumTrackTintColor={colors.brand}
                  maximumTrackTintColor={colors.surfaceTertiary}
                  thumbTintColor={colors.brand}
                />
                <View style={styles.liveRow}>
                  <View
                    style={[
                      styles.liveDot,
                      {
                        backgroundColor: liveEnabled
                          ? colors.success
                          : colors.info,
                      },
                    ]}
                  />
                  <Text style={styles.hint}>
                    {liveEnabled
                      ? `Live · Every day · ${scheduleStart} – ${scheduleEnd} · ${dimLabel}`
                      : `Every day · ${scheduleStart} – ${scheduleEnd} · ${dimLabel}`}
                  </Text>
                </View>
              </View>
            )}
          </View>
          {/* Wi-Fi setup */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>WI-FI SETUP</Text>
            <Text style={styles.hint}>
              Provision the matrix onto your network over Bluetooth.
            </Text>
            <TextInput
              testID="wifi-ssid-input"
              style={styles.nameInput}
              value={wifiSsid}
              onChangeText={setWifiSsid}
              placeholder="Wi-Fi SSID"
              placeholderTextColor={colors.info}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.pwRow}>
              <TextInput
                testID="wifi-password-input"
                style={[styles.nameInput, { flex: 1 }]}
                value={wifiPassword}
                onChangeText={setWifiPassword}
                placeholder="Wi-Fi Password"
                placeholderTextColor={colors.info}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                testID="wifi-show-password"
                onPress={() => setShowPw((v) => !v)}
                hitSlop={8}
                style={styles.pwEye}
              >
                <Ionicons
                  name={showPw ? "eye-off" : "eye"}
                  size={20}
                  color={colors.info}
                />
              </Pressable>
            </View>
            <Pressable
              testID="save-wifi-button"
              onPress={() => onSaveWifi?.(wifiSsid, wifiPassword)}
              style={({ pressed }) => [styles.wifiBtn, pressed && styles.pressed]}
            >
              <Ionicons name="wifi" size={18} color={colors.onBrand} />
              <Text style={styles.wifiBtnText}>SAVE WI-FI TO MATRIX</Text>
            </Pressable>
            <View style={styles.liveRow}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: liveEnabled ? colors.success : colors.info },
                ]}
              />
              <Text style={styles.hint}>
                {liveEnabled
                  ? "Connected — ready to send"
                  : "Connect to the matrix first to send"}
              </Text>
            </View>
            {wifiStatus && wifiStatus.state !== "idle" && (
              <View
                testID="wifi-status"
                style={[
                  styles.wifiStatus,
                  wifiStatus.state === "connected" && styles.wifiStatusOk,
                  wifiStatus.state === "failed" && styles.wifiStatusFail,
                ]}
              >
                {wifiStatus.state === "waiting" ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Ionicons
                    name={
                      wifiStatus.state === "connected"
                        ? "checkmark-circle"
                        : "close-circle"
                    }
                    size={18}
                    color={
                      wifiStatus.state === "connected"
                        ? colors.success
                        : colors.error
                    }
                  />
                )}
                <Text style={styles.wifiStatusText}>
                  {wifiStatus.state === "waiting"
                    ? "Sent · waiting for the matrix to join…"
                    : wifiStatus.state === "connected"
                      ? wifiStatus.ip
                        ? `Matrix joined · ${wifiStatus.ip}`
                        : "Matrix joined the network"
                      : "Couldn't join — check the password"}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitle: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.xl,
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 1.2,
  },
  valueBadge: {
    color: colors.brand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 0.5,
  },
  slider: {
    width: "100%",
    height: 36,
  },
  nameInput: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
  },
  wifiBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    marginTop: spacing.xs,
  },
  pwRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pwEye: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
  },
  wifiBtnText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    letterSpacing: 1.2,
  },
  wifiStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wifiStatusOk: {
    borderColor: colors.success,
  },
  wifiStatusFail: {
    borderColor: colors.error,
  },
  wifiStatusText: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
  },
  profileRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  profileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 40,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileChipActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brand,
  },
  addProfileChip: {
    borderStyle: "dashed",
  },
  profileChipText: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
    maxWidth: 140,
  },
  profileChipTextActive: {
    color: colors.brand,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
  },
  profileDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  swatchRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: "wrap",
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: {
    borderColor: colors.onSurface,
  },
  hint: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    flex: 1,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.textMedium,
    fontSize: fontSize.base,
    flex: 1,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  timeValue: {
    color: colors.onSurface,
    fontFamily: fonts.mono,
    fontSize: fontSize.lg,
    minWidth: 52,
    textAlign: "center",
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  pressed: {
    opacity: 0.7,
  },
  switchTrack: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    padding: 3,
    justifyContent: "center",
  },
  switchTrackOn: {
    backgroundColor: colors.brand,
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.onSurface,
  },
  switchThumbOn: {
    alignSelf: "flex-end",
    backgroundColor: colors.onBrand,
  },
});
