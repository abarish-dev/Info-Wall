// "Send Mom a message" — posts a short note to Mom's Wall via /api/family.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { colors } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";
import { Section } from "@/src/components/FormControls";
import { storage } from "@/src/utils/storage";
import { clearFamily, familyEnabled, getFamily, sendFamily, type FamilyMsg } from "@/src/services/family";

const MAX = 140;
const SENDERS = ["Adam", "Jessica"];

function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MomMessageSection({ open, onToggle }: { open?: boolean; onToggle?: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [current, setCurrent] = useState<FamilyMsg>({});
  const [text, setText] = useState("");
  const [sender, setSender] = useState("Adam");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    storage.getItem("momMsgSender", "Adam").then((s) => setSender(String(s))).catch(() => {});
    getFamily().then(setCurrent).catch(() => setStatus("Couldn't load current message"));
  }, []);

  const pickSender = (s: string) => {
    setSender(s);
    storage.setItem("momMsgSender", s).catch(() => {});
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setStatus("");
    try { await fn(); setStatus(ok); } catch (e: any) { setStatus(e?.message ?? "Failed"); }
    setBusy(false);
  };

  const send = () => run(async () => {
    const rec = await sendFamily(text, sender);
    setCurrent(rec);
    setText("");
  }, "Sent — it'll show on Mom's Wall within a few minutes");

  const clear = () => run(async () => { await clearFamily(); setCurrent({}); }, "Cleared");

  const enabled = familyEnabled();
  return (
    <Section icon="heart" title="SEND MOM A MESSAGE" subtitle="Shows on Mom's Wall" open={open} onToggle={onToggle}>
      <View style={styles.current}>
        <Text style={styles.label}>ON MOM'S WALL NOW</Text>
        {current.text ? (
          <>
            <Text style={styles.currentText}>“{current.text}”</Text>
            <Text style={styles.meta}>— {current.from || "Family"}{current.updated ? `  ·  ${when(current.updated)}` : ""}</Text>
          </>
        ) : (
          <Text style={styles.meta}>No message right now</Text>
        )}
      </View>

      <Text style={styles.label}>FROM</Text>
      <View style={styles.chips}>
        {SENDERS.map((s) => (
          <Pressable key={s} testID={`mom-sender-${s}`} onPress={() => pickSender(s)}
            style={[styles.chip, sender === s && styles.chipOn]}>
            <Text style={[styles.chipText, sender === s && styles.chipTextOn]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>MESSAGE</Text>
      <TextInput testID="mom-msg-input" style={styles.input} value={text} onChangeText={setText}
        placeholder="Love you, Mom! See you Sunday." placeholderTextColor={colors.info}
        multiline maxLength={MAX} />
      <Text style={styles.count}>{text.length}/{MAX}</Text>

      <View style={styles.row}>
        <Pressable testID="mom-msg-send" disabled={!enabled || busy || !text.trim()} onPress={send}
          style={[styles.btn, styles.btnPrimary, (!enabled || busy || !text.trim()) && styles.dim]}>
          {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnPrimaryText}>Send</Text>}
        </Pressable>
        <Pressable testID="mom-msg-clear" disabled={!enabled || busy || !current.text} onPress={clear}
          style={[styles.btn, styles.btnGhost, (!enabled || busy || !current.text) && styles.dim]}>
          <Text style={styles.btnGhostText}>Clear</Text>
        </Pressable>
      </View>
      {!enabled && <Text style={styles.meta}>Messaging isn't set up in this build.</Text>}
      {!!status && <Text style={styles.status}>{status}</Text>}
    </Section>
  );
}

const makeStyles = () => StyleSheet.create({
  label: { color: colors.info, fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 6, marginTop: 10 },
  current: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12, borderLeftWidth: 3, borderLeftColor: colors.brand },
  currentText: { color: colors.onSurface, fontSize: 17, lineHeight: 23 },
  meta: { color: colors.info, fontSize: 13, marginTop: 4 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceTertiary },
  chipOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  chipText: { color: colors.info, fontWeight: "600" },
  chipTextOn: { color: colors.brand },
  input: { minHeight: 84, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: "top", borderWidth: 1, borderColor: colors.surfaceTertiary },
  count: { color: colors.info, fontSize: 12, alignSelf: "flex-end", marginTop: 4 },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { color: colors.onBrand, fontWeight: "700", fontSize: 16 },
  btnGhost: { borderWidth: 1, borderColor: colors.surfaceTertiary },
  btnGhostText: { color: colors.onSurface, fontWeight: "600", fontSize: 16 },
  dim: { opacity: 0.4 },
  status: { color: colors.onSurface, fontSize: 13, marginTop: 8 },
});
