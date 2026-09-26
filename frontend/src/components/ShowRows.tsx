// TV show rows with a real show-search picker (TVmaze via our backend) and
// release highlights ("New episode today!", "Returns Sep 30", "Series ended").
// Shows are stored as canonical names (string[]), keeping the matrix payload
// unchanged.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import {
  searchShows,
  fetchShowStatus,
  type ShowSearchItem,
  type ShowStatus,
  type ShowHighlight,
} from "@/src/services/catalog";

const HL_META: Record<
  ShowHighlight,
  { icon: any; color: () => string }
> = {
  new: { icon: "radio", color: () => colors.success },
  soon: { icon: "time", color: () => colors.brand },
  returning: { icon: "calendar", color: () => colors.info },
  between: { icon: "pause-circle", color: () => colors.onSurfaceSecondary },
  ended: { icon: "checkmark-done", color: () => colors.onSurfaceSecondary },
  unknown: { icon: "help-circle", color: () => colors.warning },
  none: { icon: "ellipse", color: () => colors.info },
};

export function ShowRows({
  shows,
  onAdd,
  onRemove,
  max,
}: {
  shows: string[];
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
  max: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ShowStatus>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shows.length === 0) {
      setStatuses({});
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetchShowStatus(shows);
        const map: Record<string, ShowStatus> = {};
        res.forEach((s) => (map[s.name.toLowerCase()] = s));
        setStatuses(map);
      } catch {
        /* leave prior statuses */
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shows]);

  return (
    <View style={{ gap: spacing.md }}>
      {shows.length === 0 && (
        <Text style={styles.empty}>No shows yet — add one below.</Text>
      )}
      {shows.map((name, i) => {
        const st = statuses[name.toLowerCase()];
        const hl = st?.highlight ?? "none";
        const meta = HL_META[hl];
        return (
          <View key={`${name}-${i}`} style={styles.row} testID={`show-${i + 1}-row`}>
            <View style={styles.poster}>
              {st?.image ? (
                <Image
                  source={{ uri: st.image }}
                  style={styles.posterImg}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <Ionicons name="tv" size={22} color={colors.info} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.showName} numberOfLines={1}>
                {name}
              </Text>
              {st?.label ? (
                <View style={styles.pillRow}>
                  <Ionicons name={meta.icon} size={12} color={meta.color()} />
                  <Text style={[styles.pillText, { color: meta.color() }]}>
                    {st.label}
                  </Text>
                </View>
              ) : (
                <Text style={styles.showMeta}>
                  {hl === "unknown" ? "Couldn't find this show" : "Checking…"}
                </Text>
              )}
            </View>
            <Pressable
              testID={`show-${i + 1}-remove`}
              hitSlop={8}
              onPress={() => onRemove(i)}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={16} color={colors.info} />
            </Pressable>
          </View>
        );
      })}

      <Pressable
        testID="add-show-button"
        disabled={shows.length >= max}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setPickerOpen(true);
        }}
        style={({ pressed }) => [
          styles.addRow,
          pressed && styles.pressed,
          shows.length >= max && styles.addRowDisabled,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.brand} />
        <Text style={styles.addRowText}>Add Show</Text>
      </Pressable>

      <ShowPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selected={shows}
        onPick={(name) => {
          onAdd(name);
          setPickerOpen(false);
        }}
        styles={styles}
      />
    </View>
  );
}

function ShowPickerModal({
  visible,
  onClose,
  onPick,
  selected,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
  selected: string[];
  styles: ReturnType<typeof makeStyles>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShowSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!text.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        setResults(await searchShows(text));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  useEffect(() => {
    if (!visible) {
      setQ("");
      setResults([]);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>ADD A SHOW</Text>
          <Pressable testID="show-picker-close" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.info} />
          <TextInput
            testID="show-search-input"
            style={styles.searchInput}
            value={q}
            onChangeText={(t) => {
              setQ(t);
              runSearch(t);
            }}
            placeholder="Search TV shows…"
            placeholderTextColor={colors.info}
            autoFocus
            returnKeyType="search"
          />
          {loading && <ActivityIndicator size="small" color={colors.brand} />}
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {!loading && q.trim().length > 0 && results.length === 0 && (
            <Text style={styles.empty}>No shows found for “{q}”.</Text>
          )}
          {results.map((s) => {
            const already = selected.some(
              (n) => n.toLowerCase() === s.name.toLowerCase(),
            );
            return (
              <Pressable
                key={s.id}
                testID={`pick-show-${s.id}`}
                disabled={already}
                onPress={() => onPick(s.name)}
                style={({ pressed }) => [
                  styles.pickRow,
                  pressed && styles.pressed,
                  already && styles.pickRowDisabled,
                ]}
              >
                <View style={styles.poster}>
                  {s.image ? (
                    <Image
                      source={{ uri: s.image }}
                      style={styles.posterImg}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : (
                    <Ionicons name="tv" size={22} color={colors.info} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.showName} numberOfLines={1}>
                    {s.name}
                    {s.year ? ` (${s.year})` : ""}
                  </Text>
                  <Text style={styles.showMeta} numberOfLines={1}>
                    {[s.status, s.network, s.genres[0]]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                {already ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.success}
                  />
                ) : (
                  <Ionicons
                    name="add-circle-outline"
                    size={20}
                    color={colors.brand}
                  />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    empty: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.base,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surfaceTertiary,
      borderRadius: radius.sm,
      padding: spacing.sm,
    },
    poster: {
      width: 40,
      height: 56,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      overflow: "hidden",
    },
    posterImg: { width: "100%", height: "100%" },
    showName: {
      color: colors.onSurface,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.base,
    },
    showMeta: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
      marginTop: 2,
    },
    pillRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 3,
    },
    pillText: {
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
    },
    remove: {
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
    pressed: { opacity: 0.85 },
    // Modal
    modalRoot: { flex: 1, backgroundColor: colors.surface },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      color: colors.onSurface,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.lg,
      letterSpacing: 1.5,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surfaceTertiary,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      color: colors.onSurface,
      fontFamily: fonts.text,
      fontSize: fontSize.base,
      paddingVertical: spacing.md,
    },
    list: { padding: spacing.lg, gap: spacing.sm },
    pickRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.sm,
      padding: spacing.sm,
    },
    pickRowDisabled: { opacity: 0.5 },
  });
