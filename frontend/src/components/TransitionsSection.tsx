// "Display & Transitions" + "Travel Countdown" section. Hold-duration and
// fade-speed sliders plus an event label and departure date. Values are owned
// by the control panel and pushed live via the `transitions` BLE command.

import React, { useState } from "react";
import { View, Text, Platform, Pressable, TextInput, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { Section, TextField } from "@/src/components/FormControls";

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export function TransitionsSection({
  fadeSpeed,
  holdSeconds,
  countdownLabel,
  countdownDate,
  onChange,
}: {
  fadeSpeed: number;
  holdSeconds: number;
  countdownLabel: string;
  countdownDate: string;
  onChange: (patch: {
    fadeSpeed?: number;
    holdSeconds?: number;
    countdownLabel?: string;
    countdownDate?: string;
  }) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [showPicker, setShowPicker] = useState(false);

  const dateObj = /^\d{4}-\d{2}-\d{2}$/.test(countdownDate)
    ? new Date(countdownDate + "T00:00:00")
    : new Date();

  const onPickerChange = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowPicker(Platform.OS === "ios");
    if (selected) onChange({ countdownDate: fmtDate(selected) });
  };

  const remaining = daysUntil(countdownDate);

  return (
    <Section
      icon="film"
      title="DISPLAY & TRANSITIONS"
      subtitle="Timing and travel countdown"
    >
      {/* Hold duration */}
      <View style={styles.field}>
        <View style={styles.rowBetween}>
          <Text style={styles.fieldLabel}>Screen Hold</Text>
          <Text style={styles.value} testID="hold-value">
            {Math.round(holdSeconds)}s
          </Text>
        </View>
        <Slider
          testID="hold-slider"
          style={styles.slider}
          minimumValue={3}
          maximumValue={45}
          step={1}
          value={holdSeconds}
          onValueChange={(v) => onChange({ holdSeconds: Math.round(v) })}
          minimumTrackTintColor={colors.brand}
          maximumTrackTintColor={colors.surfaceTertiary}
          thumbTintColor={colors.brand}
        />
      </View>

      {/* Fade speed */}
      <View style={styles.field}>
        <View style={styles.rowBetween}>
          <Text style={styles.fieldLabel}>Fade Speed</Text>
          <Text style={styles.value} testID="fade-value">
            {Math.round(fadeSpeed)}/10
          </Text>
        </View>
        <Slider
          testID="fade-slider"
          style={styles.slider}
          minimumValue={1}
          maximumValue={10}
          step={1}
          value={fadeSpeed}
          onValueChange={(v) => onChange({ fadeSpeed: Math.round(v) })}
          minimumTrackTintColor={colors.brand}
          maximumTrackTintColor={colors.surfaceTertiary}
          thumbTintColor={colors.brand}
        />
        <View style={styles.scaleRow}>
          <Text style={styles.scaleText}>Smooth</Text>
          <Text style={styles.scaleText}>Fast</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Countdown label */}
      <TextField
        testID="countdown-label-input"
        label="Event Name"
        value={countdownLabel}
        placeholder="e.g. BALTIC CRUISE"
        autoCapitalize="characters"
        maxLength={20}
        onChangeText={(t) => onChange({ countdownLabel: t })}
      />

      {/* Departure date */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Departure Date</Text>
        {Platform.OS === "web" ? (
          <View style={styles.inputRow}>
            <View style={styles.dateIcon}>
              <Ionicons name="calendar" size={18} color={colors.brand} />
            </View>
            <TextInput
              testID="countdown-date-input"
              style={styles.input}
              value={countdownDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.info}
              onChangeText={(t) =>
                onChange({ countdownDate: t.replace(/[^0-9-]/g, "").slice(0, 10) })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : (
          <Pressable
            testID="countdown-date-button"
            onPress={() => setShowPicker(true)}
            style={({ pressed }) => [styles.inputRow, pressed && styles.pressed]}
          >
            <View style={styles.dateIcon}>
              <Ionicons name="calendar" size={18} color={colors.brand} />
            </View>
            <Text
              style={[
                styles.input,
                { paddingVertical: spacing.sm },
                !countdownDate && { color: colors.info },
              ]}
            >
              {countdownDate || "Select a date"}
            </Text>
          </Pressable>
        )}
        {showPicker && Platform.OS !== "web" && (
          <DateTimePicker
            value={dateObj}
            mode="date"
            display="default"
            onChange={onPickerChange}
          />
        )}
        {remaining != null && (
          <View style={styles.countdownRow} testID="countdown-preview">
            <Ionicons name="time" size={13} color={colors.brand} />
            <Text style={styles.countdownText}>
              {remaining > 0
                ? `${remaining} day${remaining === 1 ? "" : "s"} to go`
                : remaining === 0
                  ? "Today!"
                  : "Date has passed"}
            </Text>
          </View>
        )}
      </View>
    </Section>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    field: { gap: spacing.sm },
    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldLabel: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.base,
    },
    value: {
      color: colors.brand,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.lg,
      letterSpacing: 0.5,
    },
    slider: { width: "100%", height: 36 },
    scaleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: -spacing.sm,
    },
    scaleText: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: spacing.xs,
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
    dateIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      color: colors.onSurface,
      fontFamily: fonts.text,
      fontSize: fontSize.lg,
      paddingVertical: spacing.sm,
    },
    countdownRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: spacing.xs,
      paddingLeft: 2,
    },
    countdownText: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
    },
    pressed: { opacity: 0.85 },
  });
