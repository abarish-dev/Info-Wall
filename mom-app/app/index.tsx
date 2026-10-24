import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, F } from "../src/theme";

function Big({ href, label, sub, color }: { href: "/today" | "/settings" | "/wifi";
  label: string; sub: string; color: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => [s.btn, { borderColor: color, opacity: pressed ? 0.7 : 1 }]}>
        <Text style={[s.label, { color }]}>{label}</Text>
        <Text style={s.sub}>{sub}</Text>
      </Pressable>
    </Link>
  );
}

export default function Home() {
  const d = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <View style={s.wrap}>
      <Text style={s.date}>{d}</Text>
      <Big href="/today" label="Today" sub="Word, music, birthdays & more" color={C.accent} />
      <Big href="/settings" label="Wall Settings" sub="Choose what the wall shows" color={C.blue} />
      <Big href="/wifi" label="Set Up Wi-Fi" sub="Connect the wall to the internet" color={C.green} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 20, backgroundColor: C.bg },
  date: { color: C.text, fontSize: F.big, fontWeight: "700", textAlign: "center", marginVertical: 8 },
  btn: { borderWidth: 3, borderRadius: 20, padding: 24, backgroundColor: C.card },
  label: { fontSize: F.huge, fontWeight: "800" },
  sub: { color: C.dim, fontSize: F.label, marginTop: 6 },
});
