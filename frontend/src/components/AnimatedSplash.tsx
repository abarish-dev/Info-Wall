// LED-panel style animated splash. Renders a grid of "pixels" that light up
// in an ember sweep (top-left → bottom-right), the wordmark fades in, then the
// whole overlay fades out and calls onDone(). Mounted over the app in _layout
// so the native (black) splash transitions into this seamlessly.

import React, { useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  useWindowDimensions,
} from "react-native";
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
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme";

const COLS = 14;
const ROWS = 9;
const GAP = 3;

function Pixel({
  threshold,
  progress,
  size,
}: {
  threshold: number;
  progress: SharedValue<number>;
  size: number;
}) {
  const style = useAnimatedStyle(() => {
    const lit = progress.value >= threshold;
    return {
      opacity: lit ? 1 : 0.08,
      backgroundColor: lit ? colors.brand : "#2A2A2A",
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

  const pixels = useMemo(() => {
    const total = ROWS * COLS;
    return Array.from({ length: total }, (_, idx) => ({
      idx,
      threshold: idx / total,
    }));
  }, []);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 1100,
      easing: Easing.out(Easing.cubic),
    });
    fade.value = withDelay(
      1600,
      withTiming(0, { duration: 450 }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root, containerStyle]}
    >
      <View style={[styles.board, { width: boardW }]}>
        {pixels.map((p) => (
          <Pixel
            key={p.idx}
            threshold={p.threshold}
            progress={progress}
            size={cell}
          />
        ))}
      </View>
      <Animated.View
        entering={FadeIn.delay(850).duration(500)}
        style={styles.wordmarkWrap}
      >
        <Ionicons name="grid" size={22} color={colors.brand} />
        <Text style={styles.wordmark}>INFO WALL</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
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
