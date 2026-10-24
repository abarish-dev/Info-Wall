import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ensureConnected, listen, send } from "../src/services/wall";
import { C, F } from "../src/theme";

type Net = { ssid: string; rssi: number; secure: boolean };
const bars = (r: number) => (r > -55 ? "▂▄▆█" : r > -67 ? "▂▄▆" : r > -78 ? "▂▄" : "▂");

export default function Wifi() {
  const [nets, setNets] = useState<Net[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pick, setPick] = useState<Net | null>(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  const scan = async () => {
    setMsg(""); setNets([]); setPick(null); setScanning(true);
    const found: Net[] = [];
    let done = false;
    try {
      // Connect BEFORE subscribing: monitorMatrix is a no-op without a link,
      // so on a fresh app open the scan results were never heard.
      await ensureConnected();
      listen((o) => {
        if (Array.isArray(o?.ws)) {
          const [, , ssid, rssi, secure] = o.ws;
          if (ssid && !found.some((n) => n.ssid === ssid)) {
            found.push({ ssid, rssi: Number(rssi), secure: !!secure });
            setNets([...found].sort((a, b) => b.rssi - a.rssi));
          }
        } else if (typeof o?.wsDone === "number") {
          done = true;
          setScanning(false);
          if (o.wsDone < 0) setMsg("The wall couldn't scan. Try again in a moment.");
          else if (found.length === 0) setMsg("No networks found. Try again.");
        } else if (o?.wifiStatus === "connected") {
          setMsg(`Connected! The wall is online (${o.ip ?? ""}).`);
        } else if (o?.wifiStatus === "failed") {
          setMsg("That didn't work. Check the password and try again.");
        } else if (o?.wifiStatus === "connecting") {
          setMsg("Connecting…");
        }
      });
      await send({ command: "wifiScan" });
      setTimeout(() => {
        if (done) return;
        setScanning(false);
        setMsg(found.length ? "" : "The wall didn't answer. Stand closer and try again.");
      }, 20000);
    } catch (e: any) {
      setScanning(false);
      setMsg(e?.message ?? "Couldn't reach the wall. Stand closer and try again.");
    }
  };

  const join = async () => {
    if (!pick) return;
    setMsg("Sending to the wall…");
    try { await send({ command: "wifi", ssid: pick.ssid, password: pw }); }
    catch (e: any) { setMsg(e?.message ?? "Couldn't reach the wall."); }
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Pressable onPress={scan} style={[s.btn, { borderColor: C.green }]}>
        <Text style={[s.btnText, { color: C.green }]}>{scanning ? "Looking…" : "Find Wi-Fi networks"}</Text>
      </Pressable>
      {scanning && <ActivityIndicator size="large" color={C.green} />}
      {nets.map((n) => (
        <Pressable key={n.ssid} onPress={() => { setPick(n); setPw(""); setMsg(""); }}
          style={[s.net, pick?.ssid === n.ssid && { borderColor: C.accent, borderWidth: 3 }]}>
          <Text style={s.ssid} numberOfLines={1}>{n.secure ? "🔒 " : ""}{n.ssid}</Text>
          <Text style={s.bars}>{bars(n.rssi)}</Text>
        </Pressable>
      ))}
      {pick && (
        <View style={s.card}>
          <Text style={s.label}>Password for “{pick.ssid}”</Text>
          {pick.secure && (
            <TextInput value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none"
              autoCorrect={false} style={s.input} placeholder="Wi-Fi password" placeholderTextColor="#888" />
          )}
          <Pressable onPress={join} style={[s.btn, { borderColor: C.accent }]}>
            <Text style={[s.btnText, { color: C.accent }]}>Connect the wall</Text>
          </Pressable>
        </View>
      )}
      {!!msg && <Text style={s.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 48 },
  btn: { borderWidth: 3, borderRadius: 16, padding: 18, alignItems: "center", backgroundColor: C.card },
  btnText: { fontSize: F.body, fontWeight: "800" },
  net: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: C.card, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: C.border, minHeight: 70 },
  ssid: { color: C.text, fontSize: F.body, fontWeight: "700", flexShrink: 1 },
  bars: { color: C.green, fontSize: F.body },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 18, gap: 12 },
  label: { color: C.text, fontSize: F.body, fontWeight: "700" },
  input: { backgroundColor: "#FFF", color: "#000", fontSize: F.body, borderRadius: 12, padding: 14 },
  msg: { color: C.accent, fontSize: F.body, fontWeight: "700", textAlign: "center" },
});
