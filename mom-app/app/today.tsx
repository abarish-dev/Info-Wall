import * as Speech from "expo-speech";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchDaily, type Daily } from "../src/services/api";
import { C, F } from "../src/theme";

const open = (url?: string) => { if (url) WebBrowser.openBrowserAsync(url); };

function Btn({ label, onPress, color = C.accent }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [s.btn, { borderColor: color, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[s.btnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Card({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={[s.title, { color }]}>{title}</Text>
      {children}
    </View>
  );
}

// "10^2+24^2=26^2" -> "10²+24²=26²"
const sup = (t: string) => t.replace(/\^2/g, "²").replace(/\^3/g, "³");

export default function Today() {
  const [d, setD] = useState<Daily | null>(null);
  const [err, setErr] = useState("");
  const fail = () => setErr("Couldn't load today. Check the internet and try again.");
  const load = () => { setErr(""); fetchDaily().then(setD).catch(fail); };
  useEffect(() => { fetchDaily().then(setD).catch(fail); }, []);
  useEffect(() => () => { Speech.stop(); }, []);

  if (err) return (
    <View style={s.center}><Text style={s.body}>{err}</Text><Btn label="Try again" onPress={load} /></View>
  );
  if (!d) return <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>;

  const w = d.word, ct = d.classical_today;
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.wrap}>
      <Card title="Word of the Day" color={C.accent}>
        <Text style={s.word}>{w.word}</Text>
        <Text style={s.dim}>{w.pron} · {w.pos}</Text>
        <Text style={s.body}>{w.definition}</Text>
        <Text style={s.quote}>“{w.example}”</Text>
        <Text style={s.dim}>Origin: {w.origin}</Text>
        <View style={s.row}>
          <Btn label="🔊 Hear it" onPress={() => {
            Speech.stop();
            Speech.speak(`${w.word}. ${w.definition} For example: ${w.example}`, { rate: 0.85 });
          }} />
          <Btn label="More" onPress={() => open(w.more_url)} color={C.blue} />
        </View>
      </Card>

      {d.born && (
        <Card title="Born Today" color="#FF7AB6">
          <Text style={s.big}>{d.born.name}</Text>
          <Text style={s.body}>{d.born.year} · {d.born.description}</Text>
          <Btn label="Read more" onPress={() => open(d.born?.read_more)} color={C.blue} />
        </Card>
      )}

      <Card title="Classical Music" color="#B79CFF">
        <Text style={s.body}>{d.classical_fact.text}</Text>
        <View style={s.row}>
          <Btn label="▶ Listen" onPress={() => open(d.classical_fact.listen_url)} />
          <Btn label="Read more" onPress={() => open(d.classical_fact.source)} color={C.blue} />
        </View>
      </Card>

      {ct && (
        <Card title={ct.kind === "composer_born" ? "Composer Born Today" : "Music On This Day"} color="#B79CFF">
          {ct.kind === "composer_born"
            ? <><Text style={s.big}>{ct.name}</Text><Text style={s.body}>Born {ct.year} · {ct.description}</Text></>
            : <><Text style={s.big}>{ct.year}</Text><Text style={s.body}>{ct.text}</Text></>}
          <View style={s.row}>
            <Btn label="▶ Listen" onPress={() => open(ct.listen_url)} />
            <Btn label="Read more" onPress={() => open(ct.source)} color={C.blue} />
          </View>
        </Card>
      )}

      <Card title="Math of the Day" color={C.green}>
        {!!d.math.big && <Text style={s.big}>{sup(d.math.big)}</Text>}
        <Text style={s.body}>{d.math.text}</Text>
        <Btn label="Read more" onPress={() => open(d.math.source)} color={C.blue} />
      </Card>

      {!!d.family?.text && (
        <Card title="From Your Family" color="#FF7AB6">
          <Text style={s.big}>{d.family.text}</Text>
          {!!d.family.from && <Text style={s.body}>— {d.family.from}</Text>}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 20, backgroundColor: C.bg },
  card: { backgroundColor: C.card, borderRadius: 18, padding: 20, gap: 10, borderWidth: 1, borderColor: C.border },
  title: { fontSize: F.label, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  word: { color: C.text, fontSize: F.huge, fontWeight: "800" },
  big: { color: C.text, fontSize: F.big, fontWeight: "700" },
  body: { color: C.text, fontSize: F.body, lineHeight: 32 },
  quote: { color: C.text, fontSize: F.body, fontStyle: "italic", lineHeight: 32 },
  dim: { color: C.dim, fontSize: F.label },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 6 },
  btn: { borderWidth: 3, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, minHeight: 60, justifyContent: "center" },
  btnText: { fontSize: F.body, fontWeight: "800" },
});
