// Financial ticker slots with live symbol verification (Yahoo Finance via our
// backend). Invalid symbols are BLOCKED — flagged red and never pushed to the
// matrix. Valid ones show the company/fund name.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { verifyTickers, fetchQuotes, type Quote } from "@/src/services/catalog";

type SlotState = "empty" | "checking" | "valid" | "invalid" | "error";
type SlotInfo = { state: SlotState; name?: string; type?: string };

export function StockRows({
  stocks,
  onChange,
  onValidChange,
  onQuotes,
}: {
  stocks: string[];
  onChange: (stocks: string[]) => void;
  onValidChange: (valid: string[]) => void;
  onQuotes?: (quotes: Record<string, Quote>) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [info, setInfo] = useState<Record<string, SlotInfo>>({});
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitValid = useCallback(
    (map: Record<string, SlotInfo>) => {
      const seen = new Set<string>();
      const valid: string[] = [];
      stocks.forEach((raw) => {
        const sym = raw.trim().toUpperCase();
        if (!sym || seen.has(sym)) return;
        seen.add(sym);
        const st = map[sym]?.state;
        // Block only definitively-invalid symbols; keep unverified (network)
        // ones so a hiccup doesn't drop good tickers.
        if (st === "valid" || st === "error") valid.push(sym);
      });
      onValidChange(valid);
    },
    [stocks, onValidChange],
  );

  // Debounced verification whenever symbols change.
  useEffect(() => {
    const symbols = Array.from(
      new Set(stocks.map((s) => s.trim().toUpperCase()).filter(Boolean)),
    );
    if (symbols.length === 0) {
      setInfo({});
      onValidChange([]);
      return;
    }
    // Mark unknown/changed symbols as checking immediately.
    setInfo((prev) => {
      const next = { ...prev };
      symbols.forEach((s) => {
        if (!next[s]) next[s] = { state: "checking" };
      });
      return next;
    });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const results = await verifyTickers(symbols);
        const map: Record<string, SlotInfo> = {};
        results.forEach((r) => {
          map[r.symbol] = {
            state:
              r.valid === true ? "valid" : r.valid === false ? "invalid" : "error",
            name: r.name ?? undefined,
            type: r.type ?? undefined,
          };
        });
        // Keep only symbols still present.
        setInfo(map);
        emitValid(map);
      } catch {
        const map: Record<string, SlotInfo> = {};
        symbols.forEach((s) => (map[s] = { state: "error" }));
        setInfo(map);
        emitValid(map);
      }
    }, 600);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks]);

  // Live price quotes for verified-valid symbols (refreshed each minute).
  const validKey = Object.keys(info)
    .filter((k) => info[k]?.state === "valid")
    .sort()
    .join(",");
  useEffect(() => {
    const syms = validKey ? validKey.split(",") : [];
    if (syms.length === 0) {
      setQuotes({});
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetchQuotes(syms);
        if (!alive) return;
        const map: Record<string, Quote> = {};
        res.forEach((q) => (map[q.symbol] = q));
        setQuotes(map);
        onQuotes?.(map);
      } catch {
        /* keep prior */
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [validKey]);

  const setSlot = (i: number, val: string) => {
    const arr = [...stocks];
    arr[i] = val.toUpperCase();
    onChange(arr);
  };

  const validCount = stocks.filter(
    (s) => info[s.trim().toUpperCase()]?.state === "valid",
  ).length;

  return (
    <View style={{ gap: spacing.sm }}>
      {stocks.map((sym, i) => {
        const key = sym.trim().toUpperCase();
        const slot: SlotInfo = key ? info[key] ?? { state: "checking" } : { state: "empty" };
        const border =
          slot.state === "invalid"
            ? colors.error
            : slot.state === "valid"
              ? colors.success
              : slot.state === "error"
                ? colors.warning
                : colors.border;
        return (
          <View key={`stock-${i}`} testID={`stock-${i + 1}-row`}>
            <View style={[styles.inputRow, { borderColor: border }]}>
              <Text style={styles.slotLabel}>{i + 1}</Text>
              <TextInput
                testID={`stock-${i + 1}-input`}
                style={styles.input}
                value={sym}
                placeholder="AAPL"
                placeholderTextColor={colors.info}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                onChangeText={(t) => setSlot(i, t)}
              />
              <StatusIcon state={slot.state} styles={styles} />
            </View>
            {key.length > 0 && (
              <View style={styles.helperRow}>
                <Text
                  style={[
                    styles.helper,
                    slot.state === "invalid" && { color: colors.error },
                    slot.state === "valid" && { color: colors.success },
                    slot.state === "error" && { color: colors.warning },
                  ]}
                  testID={`stock-${i + 1}-helper`}
                  numberOfLines={1}
                >
                  {slot.state === "checking"
                    ? "Checking…"
                    : slot.state === "valid"
                      ? `${slot.name ?? key}${slot.type ? ` · ${slot.type}` : ""}`
                      : slot.state === "invalid"
                        ? "Unknown symbol — blocked, won't show on the wall"
                        : "Couldn't verify right now — will still be sent"}
                </Text>
                {slot.state === "valid" && quotes[key]?.price != null && (
                  <PriceBadge quote={quotes[key]} styles={styles} />
                )}
              </View>
            )}
          </View>
        );
      })}
      <Text style={styles.summary}>
        {validCount} valid symbol{validCount === 1 ? "" : "s"} will show on the
        wall.
      </Text>
    </View>
  );
}

function PriceBadge({
  quote,
  styles,
}: {
  quote: Quote;
  styles: ReturnType<typeof makeStyles>;
}) {
  const up = (quote.change ?? 0) >= 0;
  const color = up ? colors.success : colors.error;
  return (
    <View style={styles.priceBadge}>
      <Text style={styles.priceText}>
        {quote.price?.toFixed(2)}
      </Text>
      <Ionicons name={up ? "caret-up" : "caret-down"} size={11} color={color} />
      <Text style={[styles.changeText, { color }]}>
        {up ? "+" : ""}
        {quote.changePct?.toFixed(2)}%
      </Text>
    </View>
  );
}

function StatusIcon({
  state,
  styles,
}: {
  state: SlotState;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (state === "empty") return <View style={styles.iconSlot} />;
  if (state === "checking")
    return (
      <View style={styles.iconSlot}>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    );
  const map: Record<string, { name: any; color: string }> = {
    valid: { name: "checkmark-circle", color: colors.success },
    invalid: { name: "close-circle", color: colors.error },
    error: { name: "alert-circle", color: colors.warning },
  };
  const it = map[state];
  return (
    <View style={styles.iconSlot}>
      <Ionicons name={it.name} size={20} color={it.color} />
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceTertiary,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      paddingHorizontal: spacing.md,
    },
    slotLabel: {
      color: colors.info,
      fontFamily: fonts.mono,
      fontSize: fontSize.sm,
      width: 18,
    },
    input: {
      flex: 1,
      color: colors.onSurface,
      fontFamily: fonts.mono,
      fontSize: fontSize.lg,
      letterSpacing: 1.5,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    iconSlot: {
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    helper: {
      color: colors.info,
      fontFamily: fonts.text,
      fontSize: fontSize.sm,
      marginTop: 3,
      marginLeft: 4,
      flexShrink: 1,
    },
    helperRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    priceBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      marginTop: 3,
    },
    priceText: {
      color: colors.onSurface,
      fontFamily: fonts.mono,
      fontSize: fontSize.sm,
    },
    changeText: {
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
    },
    summary: {
      color: colors.onSurfaceSecondary,
      fontFamily: fonts.textMedium,
      fontSize: fontSize.sm,
      marginTop: spacing.xs,
    },
  });
