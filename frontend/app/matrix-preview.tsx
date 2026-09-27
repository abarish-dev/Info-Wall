// Live matrix preview — mirrors your CURRENT settings and cycles through the
// modules the wall is showing, honoring your visibility toggles, hold/fade
// timing, brightness and accent. Route: /matrix-preview
//
// This is still an on-screen simulation (not a pixel-exact capture of the
// firmware), but it uses your real data so you can see what's on the wall
// before you're near it.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons, {
  type IoniconsIconName,
} from "@react-native-vector-icons/ionicons";
import { colors, spacing, fonts } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { getCachedZip } from "@/src/services/geocode";
import {
  fetchQuotes,
  fetchTeamStatus,
  type Quote,
  type TeamStatus,
} from "@/src/services/catalog";
import { findTeam, teamLogoUrl, type League } from "@/src/data/teams";

const STORAGE_KEY = "matrix_settings_v2";
const REMINDERS_KEY = "episode_reminders_v1";

const CYAN = "#22D3EE";
const AMBER = "#FFB000";
const GREEN = "#39FF6A";
const WHITE = "#F2F2F2";

type Frame = { key: string; label: string; node: React.ReactNode };

function Glow({
  text,
  color,
  size = 22,
}: {
  text: string;
  color: string;
  size?: number;
}) {
  return (
    <Text
      style={[styles.led, { color, fontSize: size, textShadowColor: color }]}
    >
      {text}
    </Text>
  );
}

function daysUntil(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

function TeamGlyph({ code }: { code: string }) {
  const [bad, setBad] = useState(false);
  const [league, abbr] = code.includes(":")
    ? (code.split(":") as [League, string])
    : (["NFL", code] as [League, string]);
  const team = findTeam(league, abbr);
  const url = teamLogoUrl(league, abbr);
  return (
    <View style={styles.teamGlyph}>
      {!bad ? (
        <Image
          source={{ uri: url }}
          style={styles.teamLogo}
          contentFit="contain"
          transition={150}
          onError={() => setBad(true)}
        />
      ) : (
        <View
          style={[
            styles.teamBadge,
            { backgroundColor: team?.color ?? "#333" },
          ]}
        >
          <Text style={styles.teamBadgeText}>{abbr}</Text>
        </View>
      )}
      <Glow text={abbr} color={WHITE} size={16} />
    </View>
  );
}

export default function MatrixPreview() {
  const router = useRouter();
  const [settings, setSettings] = useState<any | null>(null);
  const [city, setCity] = useState<string>("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [teamStatuses, setTeamStatuses] = useState<Record<string, TeamStatus>>(
    {},
  );
  const [dueReminders, setDueReminders] = useState<string[]>([]);
  const [folly, setFolly] = useState<any | null>(null);
  const [lake, setLake] = useState<any | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

  // Load current settings + resolve the weather city from the geocode cache.
  useEffect(() => {
    (async () => {
      const s = await storage.getItem<any>(STORAGE_KEY, null);
      setSettings(s ?? {});
      const zip = (s?.zipCode ?? "").trim();
      if (zip.length === 5) {
        const c = await getCachedZip(zip);
        if (c) setCity(`${c.city}${c.state ? `, ${c.state}` : ""}`);
      }
      const syms = ((s?.stocks ?? []) as string[])
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
      if (syms.length) {
        try {
          const res = await fetchQuotes(syms);
          const map: Record<string, Quote> = {};
          res.forEach((q) => (map[q.symbol] = q));
          setQuotes(map);
        } catch {
          /* ignore */
        }
      }
      const teams = ((s?.teams ?? []) as string[]).filter(Boolean);
      if (teams.length) {
        try {
          const res = await fetchTeamStatus(teams);
          const map: Record<string, TeamStatus> = {};
          res.forEach((t) => (map[t.team.toUpperCase()] = t));
          setTeamStatuses(map);
        } catch {
          /* ignore */
        }
      }
      const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
      if (s?.showFolly) {
        try {
          const r = await fetch(`${base}/api/device/folly`);
          if (r.ok) setFolly(await r.json());
        } catch {
          /* ignore */
        }
      }
      if (s?.showLKN) {
        try {
          const r = await fetch(`${base}/api/device/lake`);
          if (r.ok) setLake(await r.json());
        } catch {
          /* ignore */
        }
      }
      const rem = await storage.getItem<{ label: string; airdate: string }[]>(
        REMINDERS_KEY,
        [],
      );      const today = new Date().toISOString().slice(0, 10);
      setDueReminders(
        (Array.isArray(rem) ? rem : [])
          .filter((r) => r.airdate === today)
          .map((r) => r.label),
      );
    })();
  }, []);

  const frames = useMemo<Frame[]>(() => {
    if (!settings) return [];
    const f: Frame[] = [];
    const s = settings;

    if (s.showCustomMessage && (s.msgLine1 || s.msgLine2 || s.msgLine3)) {
      f.push({
        key: "message",
        label: "Custom message",
        node: (
          <View>
            {!!s.msgLine1 && <Glow text={s.msgLine1} color={GREEN} size={18} />}
            {!!s.msgLine2 && <Glow text={s.msgLine2} color={WHITE} size={18} />}
            {!!s.msgLine3 && <Glow text={s.msgLine3} color={AMBER} size={18} />}
          </View>
        ),
      });
    }

    if (s.trackFlight && s.flightIdent) {
      f.push({
        key: "flight",
        label: "Pinned flight",
        node: (
          <View style={styles.rowCenter}>
            <Ionicons name="airplane" size={26} color={CYAN} />
            <Glow text={`  ${s.flightIdent}`} color={WHITE} size={24} />
          </View>
        ),
      });
    }

    if (s.showWeather && city) {
      f.push({
        key: "weather",
        label: "Local weather",
        node: (
          <View style={styles.rowBetween}>
            <View style={styles.rowCenter}>
              <Ionicons name="partly-sunny" size={26} color={AMBER} />
              <Glow text={`  ${city.toUpperCase()}`} color={WHITE} size={15} />
            </View>
            <Glow text="LIVE" color={AMBER} size={18} />
          </View>
        ),
      });
    }

    const teams: string[] = (s.teams ?? []).filter(Boolean);
    if (teams.length) {
      f.push({
        key: "sports",
        label: "Sports",
        node: (
          <View style={styles.teamRow}>
            {teams.slice(0, 4).map((t: string) => (
              <TeamGlyph key={t} code={t} />
            ))}
          </View>
        ),
      });
    }

    // Live / final game scores for tracked teams.
    const scoreLines = teams
      .map((t) => teamStatuses[t.toUpperCase()])
      .filter((st) => st && (st.highlight === "live" || st.highlight === "recent"))
      .slice(0, 3);
    if (scoreLines.length) {
      f.push({
        key: "scores",
        label: "Live scores",
        node: (
          <View style={{ gap: 6 }}>
            {scoreLines.map((st) => (
              <Glow
                key={st!.team}
                text={st!.label ?? ""}
                color={st!.highlight === "live" ? "#FF5A5A" : WHITE}
                size={15}
              />
            ))}
          </View>
        ),
      });
    }

    const shows: string[] = (s.shows ?? []).filter(Boolean);
    if (shows.length) {
      f.push({
        key: "tv",
        label: "TV watchlist",
        node: (
          <View style={styles.rowCenter}>
            <Ionicons name="tv" size={22} color={CYAN} />
            <Glow text={`  ${shows[0]}`} color={WHITE} size={18} />
          </View>
        ),
      });
    }

    const stocks: string[] = (s.stocks ?? []).filter(Boolean);
    if (stocks.length) {
      f.push({
        key: "stocks",
        label: "Financial ticker",
        node: (
          <View style={{ gap: 4 }}>
            {stocks.slice(0, 4).map((sym: string) => {
              const q = quotes[sym.trim().toUpperCase()];
              const up = (q?.change ?? 0) >= 0;
              return (
                <View key={sym} style={styles.rowBetween}>
                  <Glow text={sym.toUpperCase()} color={WHITE} size={18} />
                  {q?.price != null ? (
                    <Glow
                      text={`${q.price.toFixed(2)}  ${up ? "▲" : "▼"}${Math.abs(
                        q.changePct ?? 0,
                      ).toFixed(1)}%`}
                      color={up ? GREEN : "#FF5A5A"}
                      size={16}
                    />
                  ) : (
                    <Glow text="—" color={GREEN} size={16} />
                  )}
                </View>
              );
            })}
          </View>
        ),
      });
    }

    const remaining = s.showCountdown ? daysUntil(s.countdownDate ?? "") : null;
    if (s.showCountdown && s.countdownLabel && remaining != null) {
      f.push({
        key: "countdown",
        label: "Travel countdown",
        node: (
          <View style={styles.rowBetween}>
            <Glow text={s.countdownLabel} color={CYAN} size={18} />
            <View style={styles.rowCenter}>
              <Glow
                text={`${Math.max(remaining, 0)}`}
                color={AMBER}
                size={30}
              />
              <Glow text=" DAYS" color={AMBER} size={14} />
            </View>
          </View>
        ),
      });
    }

    if (s.showLKN) {
      const lvl = lake?.lvl != null ? `${lake.lvl}ft` : null;
      const diff =
        lake?.lvl != null && lake?.full != null
          ? `${lake.lvl - lake.full >= 0 ? "+" : ""}${(lake.lvl - lake.full).toFixed(1)}ft vs full`
          : null;
      f.push({
        key: "lkn",
        label: "Lake Norman",
        node: (
          <View style={{ gap: 6 }}>
            <View style={styles.rowCenter}>
              <Ionicons name="boat" size={20} color={CYAN} />
              <Glow text="  LAKE NORMAN" color={CYAN} size={16} />
            </View>
            {lvl ? (
              <>
                <Glow text={`LEVEL ${lvl}`} color={WHITE} size={18} />
                {!!diff && <Glow text={diff} color={AMBER} size={14} />}
                {lake?.w != null && lake.w > 0 && (
                  <Glow text={`WATER ${lake.w}°`} color={GREEN} size={14} />
                )}
              </>
            ) : (
              <Glow text="Duke Energy · loading…" color={WHITE} size={14} />
            )}
          </View>
        ),
      });
    }
    if (s.showFolly) {
      const ev = Array.isArray(folly?.e) ? folly.e : [];
      const line = (e: any) => (e ? `${e.y} ${e.t}  ${e.v}ft` : "");
      f.push({
        key: "folly",
        label: "Folly Beach tides",
        node: (
          <View style={{ gap: 6 }}>
            <View style={styles.rowCenter}>
              <Ionicons name="water" size={20} color={CYAN} />
              <Glow text="  FOLLY TIDES" color={AMBER} size={16} />
            </View>
            {ev.length ? (
              <>
                <Glow text={line(ev[0])} color={CYAN} size={16} />
                {!!ev[1] && <Glow text={line(ev[1])} color={WHITE} size={16} />}
                {folly?.w != null && folly.w > 0 && (
                  <Glow text={`WATER ${folly.w}°`} color={GREEN} size={14} />
                )}
              </>
            ) : (
              <Glow text="Hwy 171 bridge · loading…" color={WHITE} size={14} />
            )}
          </View>
        ),
      });
    }

    if (s.pinned) {
      f.push({
        key: "pinned",
        label: "Screen frozen (PIN on)",
        node: (
          <View style={styles.rowCenter}>
            <Ionicons name="lock-closed" size={22} color={AMBER} />
            <Glow text="  HELD ON THIS FRAME" color={AMBER} size={15} />
          </View>
        ),
      });
    }

    if (dueReminders.length) {
      f.push({
        key: "reminders",
        label: "Airing today",
        node: (
          <View style={{ gap: 6 }}>
            <View style={styles.rowCenter}>
              <Ionicons name="notifications" size={18} color={GREEN} />
              <Glow text="  NEW TONIGHT" color={GREEN} size={16} />
            </View>
            {dueReminders.slice(0, 3).map((r, i) => (
              <Glow key={i} text={r} color={WHITE} size={14} />
            ))}
          </View>
        ),
      });
    }

    return f;
  }, [settings, city, quotes, teamStatuses, dueReminders, folly, lake]);

  // Auto-cycle using the user's hold + fade timing.
  useEffect(() => {
    if (paused || frames.length <= 1) return;
    const holdMs = Math.max(2, Math.round(settings?.holdSeconds ?? 8)) * 1000;
    const fadeMs = (11 - Math.max(1, Math.min(10, settings?.fadeSpeed ?? 5))) * 110;
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: fadeMs,
        useNativeDriver: true,
      }).start(() => {
        setIdx((i) => (i + 1) % frames.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: fadeMs,
          useNativeDriver: true,
        }).start();
      });
    }, holdMs);
    return () => clearTimeout(t);
  }, [paused, frames, idx, settings, opacity]);

  const safeIdx = frames.length ? idx % frames.length : 0;
  const current = frames[safeIdx];
  const brightness = Math.max(0.2, (settings?.brightness ?? 80) / 100);

  const step = (dir: number) => {
    if (!frames.length) return;
    setIdx((i) => (i + dir + frames.length) % frames.length);
    opacity.setValue(1);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          testID="preview-back"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.h1}>MATRIX PREVIEW</Text>
        <View style={{ width: 36 }} />
      </View>

      {settings == null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : frames.length === 0 ? (
        <View style={styles.loading}>
          <Ionicons name="tv-outline" size={40} color={colors.info} />
          <Text style={styles.emptyText}>
            No modules are enabled yet. Turn on weather, sports, a message and
            more on the home screen to see them here.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.caption}>
            {current?.label} · frame {safeIdx + 1} of {frames.length}
          </Text>
          <View style={styles.panel}>
            <Animated.View
              testID="preview-frame"
              style={{ opacity: Animated.multiply(opacity, brightness) }}
            >
              {current?.node}
            </Animated.View>
          </View>

          <View style={styles.controls}>
            <Pressable
              testID="preview-prev"
              onPress={() => step(-1)}
              style={({ pressed }) => [styles.ctrlBtn, pressed && styles.pressed]}
            >
              <Ionicons name="play-skip-back" size={20} color={colors.brand} />
            </Pressable>
            <Pressable
              testID="preview-playpause"
              onPress={() => setPaused((p) => !p)}
              style={({ pressed }) => [
                styles.ctrlBtnMain,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={paused ? "play" : "pause"}
                size={22}
                color={colors.onBrand}
              />
              <Text style={styles.ctrlMainText}>
                {paused ? "PLAY" : "PAUSE"}
              </Text>
            </Pressable>
            <Pressable
              testID="preview-next"
              onPress={() => step(1)}
              style={({ pressed }) => [styles.ctrlBtn, pressed && styles.pressed]}
            >
              <Ionicons
                name="play-skip-forward"
                size={20}
                color={colors.brand}
              />
            </Pressable>
          </View>

          <View style={styles.dots}>
            {frames.map((fr, i) => (
              <View
                key={fr.key}
                style={[styles.dot, i === safeIdx && styles.dotActive]}
              />
            ))}
          </View>

          <Text style={styles.footer}>
            Cycles at your Screen Hold ({Math.round(settings?.holdSeconds ?? 8)}
            s) & Fade Speed ({Math.round(settings?.fadeSpeed ?? 5)}/10), dimmed
            to your brightness ({settings?.brightness ?? 80}%).
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  h1: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    letterSpacing: 3,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  caption: {
    color: colors.info,
    fontFamily: fonts.textMedium,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  panel: {
    backgroundColor: "#000000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1c1c1c",
    paddingVertical: 28,
    paddingHorizontal: 22,
    justifyContent: "center",
    minHeight: 140,
  },
  led: {
    fontFamily: "SpaceMono",
    letterSpacing: 1.5,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  rowCenter: { flexDirection: "row", alignItems: "center" },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  teamRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  teamGlyph: { alignItems: "center", gap: 4 },
  teamLogo: { width: 40, height: 40 },
  teamBadge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  teamBadgeText: {
    color: "#fff",
    fontFamily: fonts.displayMedium,
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  ctrlBtn: {
    width: 52,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ctrlBtnMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.brand,
  },
  ctrlMainText: {
    color: colors.onBrand,
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    letterSpacing: 1,
  },
  pressed: { opacity: 0.8 },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.surfaceTertiary,
  },
  dotActive: { backgroundColor: colors.brand, width: 18 },
  footer: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 18,
  },
});
