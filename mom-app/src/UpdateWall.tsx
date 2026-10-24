import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, F } from "./theme";
import { availableFirmware, listen, send } from "./services/wall";

const newer = (a: string, b: string) => {
  const p = (s: string) => s.split(".").map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/** Big "Update wall" button: current vs available (simple channel) + progress. */
export default function UpdateWall({ current }: { current: string | null }) {
  const [avail, setAvail] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");
  useEffect(() => { availableFirmware().then(setAvail).catch(() => setAvail(null)); }, []);
  const canUpdate = !!current && !!avail && newer(avail, current);

  const go = async () => {
    setBusy(true); setMsg("Asking the wall to update…"); setDetail("");
    try {
      listen((o) => {
        if (!o || !o.ota) return;
        if (o.ota === "installing") setMsg(`Installing v${o.version}… keep the wall plugged in`);
        else if (o.ota === "progress") setMsg(`Updating… ${o.pct}%`);
        else if (o.ota === "uptodate") { setMsg("The wall is already up to date ✓"); setBusy(false); }
        else if (o.ota === "offline") { setMsg("The wall isn't on Wi-Fi."); setBusy(false); }
        else if (o.ota === "failed") {
          setMsg("Update didn't work. Try again later.");
          if (o.step || o.err != null) setDetail(`${o.step || "?"} · code ${o.err ?? "?"}${o.msg ? ` · ${o.msg}` : ""}`);
          setBusy(false);
        }
      });
      await send({ command: "ota" });
    } catch { setMsg("Couldn't reach the wall. Stand closer and try again."); setBusy(false); }
  };

  return (
    <View style={s.card}>
      <Text style={s.line}>On the wall: {current ? `v${current}` : "—"}</Text>
      <Text style={s.line}>Newest: {avail ? `v${avail}` : "—"}</Text>
      <Pressable onPress={go} disabled={!canUpdate || busy}
        style={[s.btn, (!canUpdate || busy) && { opacity: 0.4 }]}>
        <Text style={s.btnText}>{canUpdate ? "Update wall" : "Wall is up to date"}</Text>
      </Pressable>
      {!!msg && <Text style={s.msg}>{msg}</Text>}
      {!!detail && <Text style={s.detail}>{detail}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border, gap: 10, marginTop: 12 },
  line: { color: C.dim, fontSize: F.label },
  btn: { backgroundColor: C.blue, borderRadius: 16, paddingVertical: 20, alignItems: "center", marginTop: 6 },
  btnText: { color: "#000", fontSize: F.big, fontWeight: "800" },
  msg: { color: C.text, fontSize: F.label, textAlign: "center" },
  detail: { color: C.dim, fontSize: 12, textAlign: "center" },
});
