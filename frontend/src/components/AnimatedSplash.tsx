// LED-panel style animated splash. Renders a grid of "pixels" that light up
// in an ember sweep (top-left → bottom-right), the wordmark fades in, then the
// whole overlay fades out and calls onDone(). Mounted over the app in _layout
// so the native (black) splash transitions into this seamlessly.
// Tap anywhere to skip the intro instantly.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, Text, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
  FadeIn,
  SharedValue,
} from "react-native-reanimated";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors, fonts, ACCENTS, AccentId } from "@/src/theme";
import { storage } from "@/src/utils/storage";

// Mirror of the accent storage key used on the home screen (theme_id_v1) so
// the splash can light up in the user's chosen accent from the very first frame.
const THEME_KEY = "theme_id_v1";

const COLS = 14;
const ROWS = 9;
const GAP = 3;

function Pixel({
  threshold,
  progress,
  size,
  litColor,
}: {
  threshold: number;
  progress: SharedValue<number>;
  size: number;
  litColor: string;
}) {
  const style = useAnimatedStyle(() => {
    const lit = progress.value >= threshold;
    return {
      opacity: lit ? 1 : 0.08,
      backgroundColor: lit ? litColor : "#2A2A2A",
    };
  });
  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 2,
          margin: GAP / 2,
        },
        style,
      ]}
    />
  );
}

export default function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const boardW = Math.min(width - 48, 360);
  const cell = (boardW - COLS * GAP) / COLS;

  const progress = useSharedValue(0);
  const fade = useSharedValue(1);
  const dondone = useRef(false);

  // Load the user's chosen accent so the splash matches their theme.
  const [accent, setAccent] = useState(colors.brand);
  useEffect(() => {
    storage
      .getItem<AccentId>(THEME_KEY, "orange")
      .then((id) => {
        if (id && ACCENTS[id as AccentId]) setAccent(ACCENTS[id as AccentId].brand);
      })
      .catch(() => {});
  }, []);

  const pixels = useMemo(() => {
    const total = ROWS * COLS;
    return Array.from({ length: total }, (_, idx) => ({
      idx,
      threshold: idx / total,
    }));
  }, []);

  const finish = useCallback(() => {
    if (dondone.current) return;
    dondone.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 1100,
      easing: Easing.out(Easing.cubic),
    });
    fade.value = withDelay(
      1600,
      withTiming(0, { duration: 450 }, (done) => {
        if (done) runOnJS(finish)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        { pointerEvents: "none" },
        containerStyle,
      ]}
    >
      <View style={styles.center}>
        <View style={[styles.board, { width: boardW }]}>
          {pixels.map((p) => (
            <Pixel
              key={p.idx}
              threshold={p.threshold}
              progress={progress}
              size={cell}
              litColor={accent}
            />
          ))}
        </View>
        <Animated.View
          entering={FadeIn.delay(850).duration(500)}
          style={styles.wordmarkWrap}
        >
          <Ionicons name="grid" size={22} color={accent} />
          <Text style={styles.wordmark}>INFO WALL</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#000000",
    zIndex: 1000,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  board: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
  },
  wordmarkWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 28,
  },
  wordmark: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: 26,
    letterSpacing: 4,
  },
});
