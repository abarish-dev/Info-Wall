// Family message for Mom's Wall (backend /api/family).
// The write token comes from EXPO_PUBLIC_FAMILY_TOKEN, injected at build time
// from an EAS environment variable — it is never committed to the repo.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const TOKEN = process.env.EXPO_PUBLIC_FAMILY_TOKEN ?? "";

export type FamilyMsg = { text?: string; from?: string; updated?: string };

export const familyEnabled = () => !!BASE && !!TOKEN;

export async function getFamily(wall = "mom"): Promise<FamilyMsg> {
  const r = await fetch(`${BASE}/api/family?wall=${encodeURIComponent(wall)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function sendFamily(text: string, sender: string, wall = "mom"): Promise<FamilyMsg> {
  const r = await fetch(`${BASE}/api/family`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Family-Token": TOKEN },
    body: JSON.stringify({ text, sender, wall }),
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Not authorized" : `HTTP ${r.status}`);
  return r.json();
}

export async function clearFamily(wall = "mom"): Promise<void> {
  const r = await fetch(`${BASE}/api/family?wall=${encodeURIComponent(wall)}`, {
    method: "DELETE",
    headers: { "X-Family-Token": TOKEN },
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Not authorized" : `HTTP ${r.status}`);
}
