// Reusable form controls for the control panel: a titled Section card, a
// labelled text field (with optional inline warning + remove button), an
// icon-prefixed text field, and a dashed "add row" button. Each builds its own
// themed StyleSheet via useThemedStyles so it follows the active accent.

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import Ionicons, {
  type IoniconsIconName,
} from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function Section({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
  testID,
  open: openProp,
  onToggle,
}: {
  icon: IoniconsIconName;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testID?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const controlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlled ? openProp : internalOpen;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (controlled) onToggle?.();
    else setInternalOpen((o) => !o);
    Haptics.selectionAsync().catch(() => {});
  };
  return (
    <View style={styles.section}>
      <Pressable
        testID={testID ?? `section-${title}`}
        onPress={toggle}
        style={({ pressed }) => [
          styles.sectionHeader,
          !open && styles.sectionHeaderClosed,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.info}
        />
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  onChangeText,
  autoCapitalize,
  maxLength,
  testID,
  onRemove,
  warning,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (t: string) => void;
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  maxLength?: number;
  testID: string;
  onRemove?: () => void;
  warning?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
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
            style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={16} color={colors.info} />
          </Pressable>
        )}
      </View>
      {warning ? (
        <View style={styles.warnRow} testID={`${testID}-warning`}>
          <Ionicons
            name="alert-circle-outline"
            size={13}
            color={colors.warning}
          />
          <Text style={styles.warnText}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function IconInput({
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
  icon: IoniconsIconName;
  keyboardType?: "default" | "number-pad";
  maxLength?: number;
  editable?: boolean;
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
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

export function AddRowButton({
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = () =>
  StyleSheet.create({
    pressed: { opacity: 0.85 },
    section: { marginBottom: spacing.xl },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    sectionHeaderClosed: {
      marginBottom: 0,
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
    field: { gap: spacing.sm },
    fieldDisabled: { opacity: 0.45 },
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
    inputRowFocused: { borderColor: colors.borderStrong },
    avatar: {
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
    addRowDisabled: { opacity: 0.4 },
    addRowText: {
      color: colors.brand,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.base,
    },
  });
