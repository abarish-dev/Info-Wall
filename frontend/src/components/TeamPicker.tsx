// Sports team rows with real ESPN logos + official colors, plus a modal to
// pick a team by league. Teams are stored as "LEAGUE:ABBR" (e.g. "NFL:DAL"),
// matching the matrix firmware contract.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import {
  fetchTeamStatus,
  type TeamStatus,
  type TeamGameHighlight,
} from "@/src/services/catalog";
import {
  LEAGUES,
  LEAGUE_LABEL,
  TEAMS,
  findTeam,
  teamLogoUrl,
  readableOn,
  type League,
} from "@/src/data/teams";

const TEAM_HL: Record<TeamGameHighlight, { icon: any; color: () => string }> = {
  live: { icon: "radio", color: () => colors.error },
  today: { icon: "flame", color: () => colors.brand },
  soon: { icon: "calendar", color: () => colors.info },
  upcoming: { icon: "calendar-outline", color: () => colors.onSurfaceSecondary },
  recent: { icon: "checkmark-done", color: () => colors.onSurfaceSecondary },
  offseason: { icon: "bed", color: () => colors.onSurfaceSecondary },
  none: { icon: "ellipse", color: () => colors.info },
};

export function parseTeam(value: string): { league: League; abbr: string } | null {
  const [lg, abbr] = value.split(":");
  if (LEAGUES.includes(lg as League) && abbr) {
    return { league: lg as League, abbr };
  }
  return null;
}

function TeamLogo({
  league,
  abbr,
  color,
  size,
}: {
  league: League;
  abbr: string;
  color: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: readableOn(color),
            fontFamily: fonts.displayMedium,
            fontSize: size * 0.34,
          }}
        >
          {abbr}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: teamLogoUrl(league, abbr) }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

export function TeamRows({
  teams,
  onRemove,
  onAdd,
  max,
  statuses: statusesProp,
}: {
  teams: string[];
  onRemove: (index: number) => void;
  onAdd: (value: string) => void;
  max: number;
  statuses?: Record<string, TeamStatus>;
}) {
  const styles = useThemedStyles(makeStyles);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [internalStatuses, setInternalStatuses] = useState<
    Record<string, TeamStatus>
  >({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = teams.join("|");
  const statuses = statusesProp ?? internalStatuses;

  useEffect(() => {
    if (statusesProp) return; // parent supplies statuses
    if (teams.length === 0) {
      setInternalStatuses({});
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetchTeamStatus(teams);
        const map: Record<string, TeamStatus> = {};
        res.forEach((s) => (map[s.team.toUpperCase()] = s));
        setInternalStatuses(map);
      } catch {
        /* keep prior */
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, statusesProp]);

  return (
    <View style={{ gap: spacing.md }}>
      {teams.length === 0 && (
        <Text style={styles.empty}>No teams yet — add one below.</Text>
      )}
      {teams.map((value, i) => {
        const parsed = parseTeam(value);
        const team = parsed ? findTeam(parsed.league, parsed.abbr) : undefined;
        const color = team?.color ?? colors.surfaceTertiary;
        const st = statuses[value.toUpperCase()];
        const hl = st?.highlight ?? "none";
        const meta = TEAM_HL[hl];
        return (
          <View key={`${value}-${i}`} style={styles.row} testID={`team-${i + 1}-row`}>
            <View style={[styles.swatch, { backgroundColor: color }]}>
              {parsed && (
                <TeamLogo
                  league={parsed.league}
                  abbr={parsed.abbr}
                  color={color}
                  size={30}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName}>
                {team ? `${team.city} ${team.name}` : value}
              </Text>
              {st?.label ? (
                <View style={styles.pillRow}>
                  <Ionicons name={meta.icon} size={12} color={meta.color()} />
                  <Text style={[styles.pillText, { color: meta.color() }]}>
                    {st.label}
                  </Text>
                </View>
              ) : (
                <Text style={styles.teamMeta}>
                  {parsed ? `${parsed.league} · ${parsed.abbr}` : "Unknown"}
                </Text>
              )}
            </View>
            <Pressable
              testID={`team-${i + 1}-remove`}
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
        testID="add-team-button"
        disabled={teams.length >= max}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setPickerOpen(true);
        }}
        style={({ pressed }) => [
          styles.addRow,
          pressed && styles.pressed,
          teams.length >= max && styles.addRowDisabled,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.brand} />
        <Text style={styles.addRowText}>Add Team</Text>
      </Pressable>

      <TeamPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selected={teams}
        onPick={(value) => {
          onAdd(value);
          setPickerOpen(false);
        }}
        styles={styles}
      />
    </View>
  );
}

function TeamPickerModal({
  visible,
  onClose,
  onPick,
  selected,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (value: string) => void;
  selected: string[];
  styles: ReturnType<typeof makeStyles>;
}) {
  const [league, setLeague] = useState<League>("NFL");
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>ADD A TEAM</Text>
          <Pressable testID="team-picker-close" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.leagueRow}>
          {LEAGUES.map((lg) => {
            const active = lg === league;
            return (
              <Pressable
                key={lg}
                testID={`league-${lg}`}
                onPress={() => setLeague(lg)}
                style={[styles.leagueChip, active && styles.leagueChipActive]}
              >
                <Text
                  style={[
                    styles.leagueChipText,
                    active && styles.leagueChipTextActive,
                  ]}
                >
                  {lg}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.leagueSub}>{LEAGUE_LABEL[league]}</Text>

        <ScrollView contentContainerStyle={styles.list}>
          {TEAMS[league].map((t) => {
            const value = `${league}:${t.abbr}`;
            const already = selected.includes(value);
            return (
              <Pressable
                key={value}
                testID={`pick-${value}`}
                disabled={already}
                onPress={() => onPick(value)}
                style={({ pressed }) => [
                  styles.pickRow,
                  pressed && styles.pressed,
                  already && styles.pickRowDisabled,
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: t.color }]}>
                  <TeamLogo
                    league={league}
                    abbr={t.abbr}
                    color={t.color}
                    size={28}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.teamName}>
                    {t.city} {t.name}
                  </Text>
                  <Text style={styles.teamMeta}>{t.abbr}</Text>
                </View>
                {already ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                ) : (
                  <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
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
    swatch: {
      width: 44,
      height: 44,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    teamName: {
      color: colors.onSurface,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.base,
    },
    teamMeta: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
      marginTop: 1,
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
    leagueRow: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    leagueChip: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    leagueChipActive: {
      borderColor: colors.brand,
      backgroundColor: colors.brandTertiary,
    },
    leagueChipText: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.base,
      letterSpacing: 1,
    },
    leagueChipTextActive: { color: colors.brand },
    leagueSub: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
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
