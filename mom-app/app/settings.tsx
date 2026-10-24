import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { applyToggles, DEFAULT_TOGGLES, loadToggles, type Toggles } from "../src/services/wall";
import { C, F } from "../src/theme";

const ROWS: [keyof Toggles, string][] = [
  ["weather", "Weather & forecast"], ["moon", "Moon"], ["map", "World clock & map"],
  ["clock", "Big clock"], ["planes", "Planes overhead"],
  ["born", "Born today"], ["word", "Word of the day"], ["cfact", "Classical music fact"],
  ["ctoday", "Classical music on this day"], ["math", "Math of the day"], ["family", "Family message"],
];

export default function Settings() {
  const [t, setT] = useState<Toggles>(DEFAULT_TOGGLES);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const queued = useRef<Toggles | null>(null);
  useEffect(() => { loadToggles().then(setT); }, []);

  const push = async (next: Toggles) => {
    if (busy) { queued.current = next; return; }
    setBusy(true); setStatus("Sending to the wall…");
    try {
      let cur: Toggles | null = next;
      while (cur) { queued.current = null; await applyToggles(cur); cur = queued.current; }
      setStatus("Saved on the wall ✓");
    } catch (e: any) {
      setStatus(e?.message ? `Couldn't reach the wall: ${e.message}` : "Couldn't reach the wall. Stand closer and try again.");
    } finally { setBusy(false); }
  };

  const flip = (k: keyof Toggles) => { const next = { ...t, [k]: !t[k] }; setT(next); push(next); };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.wrap}>
      {ROWS.map(([k, label]) => (
        <Pressable key={k} onPress={() => flip(k)} accessibilityRole="switch"
          accessibilityState={{ checked: t[k] }} style={s.row}>
          <Text style={s.label}>{label}</Text>
          <Switch value={t[k]} onValueChange={() => flip(k)}
            trackColor={{ true: C.green, false: "#555" }} thumbColor="#FFF"
            style={{ transform: [{ scale: 1.4 }] }} />
        </Pressable>
      ))}
      <View style={s.status}>
        {busy && <ActivityIndicator color={C.accent} />}
        <Text style={s.statusText}>{status}</Text>
      </View>
      <Pressable onPress={() => push(t)} style={s.resend}>
        <Text style={s.resendText}>Send all to wall again</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10, paddingBottom: 48 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.card, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 20,
    borderWidth: 1, borderColor: C.border, minHeight: 76 },
  label: { color: C.text, fontSize: F.body, fontWeight: "700", flexShrink: 1, marginRight: 12 },
  status: { flexDirection: "row", gap: 10, alignItems: "center", minHeight: 40, marginTop: 8 },
  statusText: { color: C.dim, fontSize: F.label, flexShrink: 1 },
  resend: { borderWidth: 3, borderColor: C.blue, borderRadius: 14, padding: 16, alignItems: "center" },
  resendText: { color: C.blue, fontSize: F.body, fontWeight: "800" },
});
