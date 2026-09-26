// TEMP visual mock — a simulated preview of what the LED matrix would cycle
// through on-device. This is a DESIGN MOCK only (not real firmware output);
// it exists so we can approve the on-matrix layout before writing draw code.
// Route: /matrix-preview

import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons, {
  type IoniconsIconName,
} from "@react-native-vector-icons/ionicons";
import { colors, spacing, fonts } from "@/src/theme";

// A ~128x32 style wide RGB panel. Chunky mono glyphs on pure black with a
// glow read as an LED matrix.
function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.panelWrap}>
      <Text style={styles.caption}>{label}</Text>
      <View style={styles.panel}>{children}</View>
    </View>
  );
}

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
      style={[
        styles.led,
        {
          color,
          fontSize: size,
          textShadowColor: color,
        },
      ]}
    >
      {text}
    </Text>
  );
}

function LedIcon({
  name,
  color,
  size = 26,
}: {
  name: IoniconsIconName;
  color: string;
  size?: number;
}) {
  return (
    <View style={{ textShadowColor: color } as never}>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

const GREEN = "#39FF6A";
const AMBER = "#FFB000";
const CYAN = "#22D3EE";
const RED = "#FF4D4D";
const WHITE = "#F2F2F2";

export default function MatrixPreview() {
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>MATRIX PREVIEW</Text>
        <Text style={styles.sub}>
          A design mock of the frames your LED wall cycles through. Not live
          firmware output — approve the look, then I&apos;ll write the draw code.
        </Text>

        {/* FLIGHT */}
        <Panel label="Flight tracking (radius / poly zone hit)">
          <View style={styles.rowCenter}>
            <LedIcon name="airplane" color={CYAN} />
            <View style={{ marginLeft: 12 }}>
              <Glow text="DAL520" color={WHITE} size={22} />
              <Glow text="ATL → CLT  35,000FT" color={CYAN} size={13} />
            </View>
          </View>
        </Panel>

        {/* WEATHER */}
        <Panel label="Weather (from your Zip)">
          <View style={styles.rowBetween}>
            <View style={styles.rowCenter}>
              <LedIcon name="partly-sunny" color={AMBER} />
              <Glow text="  MOORESVILLE" color={WHITE} size={16} />
            </View>
            <Glow text="72°F" color={AMBER} size={26} />
          </View>
        </Panel>

        {/* SPORTS */}
        <Panel label="Sports (live score)">
          <View style={styles.rowBetween}>
            <Glow text="NYY" color="#0C2340" size={22} />
            <Glow text="5" color={WHITE} size={26} />
            <Glow text="—" color="#555" size={22} />
            <Glow text="3" color={WHITE} size={26} />
            <Glow text="BOS" color={RED} size={22} />
          </View>
        </Panel>

        {/* STOCKS */}
        <Panel label="Financial ticker (scrolling)">
          <View style={styles.rowBetween}>
            <Glow text="AAPL 213.40" color={WHITE} size={18} />
            <View style={styles.rowCenter}>
              <Ionicons name="caret-up" size={16} color={GREEN} />
              <Glow text=" 1.24%" color={GREEN} size={18} />
            </View>
          </View>
        </Panel>

        {/* COUNTDOWN */}
        <Panel label="Travel countdown">
          <View style={styles.rowBetween}>
            <View>
              <Glow text="BALTIC CRUISE" color={CYAN} size={16} />
              <Glow text="SEP 14, 2026" color="#7DE3F2" size={12} />
            </View>
            <View style={styles.rowCenter}>
              <Glow text="45" color={AMBER} size={30} />
              <Glow text=" DAYS" color={AMBER} size={14} />
            </View>
          </View>
        </Panel>

        {/* CUSTOM MESSAGE */}
        <Panel label="Custom 3-line message">
          <View>
            <Glow text="WELCOME HOME" color={GREEN} size={16} />
            <Glow text="DINNER AT 7" color={WHITE} size={16} />
            <Glow text="GO PANTHERS!" color={AMBER} size={16} />
          </View>
        </Panel>

        {/* PINNED / LOCK */}
        <Panel label="Screen frozen (PIN / lock on)">
          <View style={styles.rowCenter}>
            <LedIcon name="lock-closed" color={AMBER} size={20} />
            <Glow text="  HELD ON THIS FRAME" color={AMBER} size={15} />
          </View>
        </Panel>

        <Text style={styles.footer}>
          Modules honor your visibility toggles, hold/fade timing, brightness &
          schedule, and the accent theme.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  h1: {
    color: colors.onSurface,
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    letterSpacing: 3,
  },
  sub: {
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  panelWrap: { gap: 6 },
  caption: {
    color: colors.info,
    fontFamily: fonts.textMedium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  panel: {
    backgroundColor: "#000000",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1c1c1c",
    paddingVertical: 18,
    paddingHorizontal: 18,
    justifyContent: "center",
    minHeight: 78,
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
  footer: {
    color: colors.info,
    fontFamily: fonts.text,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
