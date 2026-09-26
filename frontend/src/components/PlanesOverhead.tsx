// "Planes Overhead" — a live card of aircraft currently near the user's
// resolved location (from the Weather zip), with real airline logos. Data
// comes from our /api/flights/nearby proxy. The list only mounts (and starts
// polling) while the section is expanded.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { Section } from "@/src/components/FormControls";
import {
  fetchNearbyFlights,
  bearingToCompass,
  nmToMiles,
  type NearbyFlight,
} from "@/src/services/flights";

const REFRESH_MS = 25000;

export function PlanesOverhead({
  lat,
  lon,
  radiusMiles,
  locationLabel,
  open,
  onToggle,
}: {
  lat: number | null;
  lon: number | null;
  radiusMiles: number;
  locationLabel?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <Section
      icon="paper-plane"
      title="PLANES OVERHEAD"
      subtitle="Live flights near you"
      open={open}
      onToggle={onToggle}
    >
      {lat == null || lon == null ? (
        <NoLocation />
      ) : (
        <PlanesList
          lat={lat}
          lon={lon}
          radiusMiles={radiusMiles}
          locationLabel={locationLabel}
        />
      )}
    </Section>
  );
}

function NoLocation() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.emptyRow} testID="planes-no-location">
      <Ionicons name="location-outline" size={16} color={colors.warning} />
      <Text style={styles.emptyText}>
        Enter a zip code in Weather to set your location, then live flights
        overhead will appear here.
      </Text>
    </View>
  );
}

function PlanesList({
  lat,
  lon,
  radiusMiles,
  locationLabel,
}: {
  lat: number;
  lon: number;
  radiusMiles: number;
  locationLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [flights, setFlights] = useState<NearbyFlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [badLogos, setBadLogos] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await fetchNearbyFlights(lat, lon, radiusMiles);
        if (!mounted.current) return;
        setFlights(data);
        setError(false);
        setUpdatedAt(Date.now());
      } catch {
        if (!mounted.current) return;
        setError(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [lat, lon, radiusMiles],
  );

  useEffect(() => {
    mounted.current = true;
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load]);

  const onRefresh = () => {
    Haptics.selectionAsync().catch(() => {});
    load();
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.headerRow}>
        <Text style={styles.headerText} numberOfLines={1}>
          {locationLabel ? `Near ${locationLabel}` : "Near your location"} ·{" "}
          {radiusMiles} mi
        </Text>
        <Pressable
          testID="planes-refresh"
          onPress={onRefresh}
          hitSlop={8}
          style={({ pressed }) => [styles.refreshBtn, pressed && styles.pressed]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.brand} />
          ) : (
            <Ionicons name="refresh" size={16} color={colors.brand} />
          )}
        </Pressable>
      </View>

      {loading && flights.length === 0 ? (
        <View style={styles.emptyRow} testID="planes-loading">
          <ActivityIndicator size="small" color={colors.brand} />
          <Text style={styles.emptyText}>Scanning the skies…</Text>
        </View>
      ) : error && flights.length === 0 ? (
        <View style={styles.emptyRow} testID="planes-error">
          <Ionicons name="cloud-offline" size={16} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.error }]}>
            Couldn&apos;t reach the flight feed. Tap refresh to retry.
          </Text>
        </View>
      ) : flights.length === 0 ? (
        <View style={styles.emptyRow} testID="planes-empty">
          <Ionicons name="airplane-outline" size={16} color={colors.info} />
          <Text style={styles.emptyText}>
            No aircraft in range right now. Widen the search radius or try again.
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }} testID="planes-list">
          {flights.map((f, i) => {
            const key = f.hex ?? `${f.callsign}-${i}`;
            const miles = nmToMiles(f.distance);
            const showLogo = f.logo && !badLogos[key];
            const meta = [
              f.airline ?? f.type ?? "Aircraft",
              f.altitude != null
                ? `${Math.round(f.altitude).toLocaleString()} ft`
                : null,
              miles != null ? `${miles.toFixed(1)} mi` : null,
              bearingToCompass(f.direction),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <View key={key} style={styles.flightRow} testID={`plane-${key}`}>
                <View style={styles.logoWrap}>
                  {showLogo ? (
                    <Image
                      source={{ uri: f.logo as string }}
                      style={styles.logo}
                      contentFit="contain"
                      transition={150}
                      onError={() =>
                        setBadLogos((prev) => ({ ...prev, [key]: true }))
                      }
                    />
                  ) : (
                    <Ionicons name="airplane" size={20} color={colors.brand} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.callsign} numberOfLines={1}>
                    {f.callsign}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {meta}
                  </Text>
                </View>
                {f.type ? <Text style={styles.typeBadge}>{f.type}</Text> : null}
              </View>
            );
          })}
        </View>
      )}

      {updatedAt && (
        <Text style={styles.updated} testID="planes-updated">
          Updated {relTime(updatedAt)} · auto-refreshes every 25s
        </Text>
      )}
    </View>
  );
}

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

const makeStyles = () =>
  StyleSheet.create({
    pressed: { opacity: 0.75 },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerText: {
      flex: 1,
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.base,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceTertiary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    emptyText: {
      flex: 1,
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
    },
    flightRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surfaceTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    logoWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    logo: { width: 34, height: 34 },
    callsign: {
      color: colors.onSurface,
      fontFamily: fonts.displayMedium,
      fontSize: fontSize.lg,
      letterSpacing: 0.5,
    },
    meta: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
      marginTop: 1,
    },
    typeBadge: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.mono,
      fontSize: fontSize.sm,
      backgroundColor: colors.surfaceSecondary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      overflow: "hidden",
    },
    updated: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: 10,
    },
  });
