import { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { C, F } from "./theme";

/** Big, simple 10–100 % slider with a large thumb (no extra packages). */
export default function BrightnessSlider({ value, onChange, onDone }: {
  value: number; onChange: (v: number) => void; onDone: (v: number) => void;
}) {
  const [w, setW] = useState(1);
  const cur = useRef(value); cur.current = value;
  const at = (x: number) => Math.round(Math.min(100, Math.max(10, (x / w) * 100)) / 5) * 5;
  const pct = (value - 10) / 90;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.label}>Brightness</Text>
        <Text style={s.val}>{value}%</Text>
      </View>
      <View style={s.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderGrant: (e) => onChange(at(e.nativeEvent.locationX)),
          onPanResponderMove: (e) => onChange(at(e.nativeEvent.locationX)),
          onPanResponderRelease: () => onDone(cur.current),
          onPanResponderTerminationRequest: () => false,
        }).panHandlers}
        accessibilityRole="adjustable" accessibilityLabel="Brightness" accessibilityValue={{ min: 10, max: 100, now: value }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const v = Math.min(100, Math.max(10, value + (e.nativeEvent.actionName === "increment" ? 10 : -10)));
          onChange(v); onDone(v);
        }}>
        <View pointerEvents="none" style={s.rail} />
        <View pointerEvents="none" style={[s.fill, { width: `${pct * 100}%` }]} />
        <View pointerEvents="none" style={[s.thumb, { left: pct * (w - 56) }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border, gap: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: C.text, fontSize: F.body, fontWeight: "700" },
  val: { color: C.accent, fontSize: F.body, fontWeight: "700" },
  track: { height: 64, justifyContent: "center" },
  rail: { position: "absolute", left: 0, right: 0, height: 14, borderRadius: 7, backgroundColor: "#444" },
  fill: { position: "absolute", left: 0, height: 14, borderRadius: 7, backgroundColor: C.accent },
  thumb: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: "#FFF",
    borderWidth: 4, borderColor: C.accent },
});
