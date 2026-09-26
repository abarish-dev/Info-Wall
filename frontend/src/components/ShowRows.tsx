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
  Linking,
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
  fetchEpisodes,
  type ShowSearchItem,
  type ShowStatus,
  type ShowHighlight,
  type EpisodesInfo,
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

export type Reminder = {
  key: string;
  show: string;
  label: string;
  airdate: string | null;
};

export function ShowRows({
  shows,
  onAdd,
  onRemove,
  max,
  statuses: statusesProp,
  reminderKeys,
  onToggleReminder,
}: {
  shows: string[];
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
  max: number;
  statuses?: Record<string, ShowStatus>;
  reminderKeys?: Set<string>;
  onToggleReminder?: (r: Reminder) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [internalStatuses, setInternalStatuses] = useState<
    Record<string, ShowStatus>
  >({});
  const [episodesFor, setEpisodesFor] = useState<ShowStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statuses = statusesProp ?? internalStatuses;

  useEffect(() => {
    if (statusesProp) return; // parent supplies statuses
    if (shows.length === 0) {
      setInternalStatuses({});
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetchShowStatus(shows);
        const map: Record<string, ShowStatus> = {};
        res.forEach((s) => (map[s.name.toLowerCase()] = s));
        setInternalStatuses(map);
      } catch {
        /* leave prior statuses */
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shows, statusesProp]);

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
          <Pressable
            key={`${name}-${i}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`show-${i + 1}-row`}
            onPress={() => st?.id && setEpisodesFor(st)}
            disabled={!st?.id}
          >
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
            {st?.id ? (
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            ) : null}
            <Pressable
              testID={`show-${i + 1}-remove`}
              hitSlop={8}
              onPress={() => onRemove(i)}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={16} color={colors.info} />
            </Pressable>
          </Pressable>
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

      <EpisodesModal
        show={episodesFor}
        onClose={() => setEpisodesFor(null)}
        reminderKeys={reminderKeys}
        onToggleReminder={onToggleReminder}
        styles={styles}
      />
    </View>
  );
}

function EpisodesModal({
  show,
  onClose,
  styles,
  reminderKeys,
  onToggleReminder,
}: {
  show: ShowStatus | null;
  onClose: () => void;
  styles: ReturnType<typeof makeStyles>;
  reminderKeys?: Set<string>;
  onToggleReminder?: (r: Reminder) => void;
}) {
  const [info, setInfo] = useState<EpisodesInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show?.id) {
      setInfo(null);
      return;
    }
    setLoading(true);
    setInfo(null);
    fetchEpisodes(show.id)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [show?.id]);

  const epLine = (e: {
    season: number | null;
    number: number | null;
    name: string | null;
    airdate: string | null;
  }) =>
    `S${e.season ?? "?"}·E${e.number ?? "?"}  ${e.name ?? ""}`.trim();

  return (
    <Modal
      visible={!!show}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {(show?.matchedName ?? show?.name ?? "SHOW").toUpperCase()}
          </Text>
          <Pressable testID="episodes-close" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : !info ? (
          <View style={styles.centerFill}>
            <Text style={styles.showMeta}>Couldn&apos;t load episodes.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <View style={styles.infoBar}>
              {show?.image ? (
                <Image
                  source={{ uri: show.image }}
                  style={styles.bigPoster}
                  contentFit="cover"
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.infoStat}>{info.status ?? ""}</Text>
                <Text style={styles.showMeta}>
                  {info.seasons} season{info.seasons === 1 ? "" : "s"} ·{" "}
                  {info.totalEpisodes} episodes
                </Text>
                {info.network ? (
                  <Text style={styles.showMeta}>{info.network}</Text>
                ) : null}
                {show?.imdb ? (
                  <Pressable
                    testID="episodes-imdb"
                    onPress={() => Linking.openURL(show.imdb as string)}
                    style={styles.imdbBtn}
                  >
                    <Ionicons name="open-outline" size={13} color={colors.brand} />
                    <Text style={styles.imdbText}>View on IMDb</Text>
                  </Pressable>
                ) : null}
                {info.watchUrl ? (
                  <Pressable
                    testID="episodes-watch"
                    onPress={() => Linking.openURL(info.watchUrl as string)}
                    style={styles.watchBtn}
                  >
                    <Ionicons name="play-circle" size={14} color={colors.onBrand} />
                    <Text style={styles.watchText}>
                      Watch{info.watchName ? ` on ${info.watchName}` : ""}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {info.upcoming.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>UPCOMING</Text>
                {info.upcoming.map((e, i) => {
                  const rKey = `${show?.name}|S${e.season}E${e.number}`;
                  const reminded = reminderKeys?.has(rKey);
                  return (
                    <View key={`u-${i}`} style={styles.epRow}>
                      <View style={styles.epDate}>
                        <Ionicons name="calendar" size={13} color={colors.brand} />
                        <Text style={styles.epDateText}>{e.airdate}</Text>
                      </View>
                      <Text style={styles.epName} numberOfLines={1}>
                        {epLine(e)}
                      </Text>
                      {onToggleReminder && (
                        <Pressable
                          testID={`remind-${i}`}
                          hitSlop={8}
                          onPress={() =>
                            onToggleReminder({
                              key: rKey,
                              show: show?.name ?? "",
                              label: `${show?.name} ${epLine(e)}`,
                              airdate: e.airdate,
                            })
                          }
                          style={({ pressed }) => [
                            styles.bellBtn,
                            reminded && styles.bellBtnOn,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Ionicons
                            name={reminded ? "notifications" : "notifications-outline"}
                            size={16}
                            color={reminded ? colors.onBrand : colors.brand}
                          />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </>
            )}

            {info.recent.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>RECENT</Text>
                {info.recent.map((e, i) => (
                  <View key={`r-${i}`} style={[styles.epRow, { opacity: 0.7 }]}>
                    <View style={styles.epDate}>
                      <Ionicons
                        name="checkmark-done"
                        size={13}
                        color={colors.info}
                      />
                      <Text style={styles.epDateText}>{e.airdate}</Text>
                    </View>
                    <Text style={styles.epName} numberOfLines={1}>
                      {epLine(e)}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {info.upcoming.length === 0 && info.recent.length === 0 && (
              <Text style={styles.showMeta}>No episode data available.</Text>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
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
    centerFill: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    infoBar: {
      flexDirection: "row",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    bigPoster: {
      width: 70,
      height: 98,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceSecondary,
    },
    infoStat: {
      color: colors.onSurface,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.lg,
    },
    imdbBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: spacing.sm,
    },
    imdbText: {
      color: colors.brand,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
    },
    watchBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: spacing.sm,
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
    },
    watchText: {
      color: colors.onBrand,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
    },
    bellBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bellBtnOn: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    sectionLabel: {
      color: colors.info,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.sm,
      letterSpacing: 1.5,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    epRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surfaceTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.xs,
    },
    epDate: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      width: 96,
    },
    epDateText: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.mono,
      fontSize: fontSize.sm,
    },
    epName: {
      flex: 1,
      color: colors.onSurface,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
    },
  });
