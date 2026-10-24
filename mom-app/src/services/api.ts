const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type Daily = {
  date: string;
  word: { word: string; pron: string; pos: string; definition: string; short: string;
    origin: string; example: string; more_url: string };
  classical_fact: { text: string; source: string; listen_url: string };
  classical_today: null | { kind: "event" | "composer_born"; year: number; text: string;
    name?: string; description?: string; source: string; listen_url: string };
  math: { big: string; text: string; source: string };
  born: null | { name: string; year: number; description: string; read_more: string;
    thumb?: string; age: number };
  family: { text?: string; from?: string; updated?: string };
};

export async function fetchDaily(): Promise<Daily> {
  const r = await fetch(`${BASE}/api/daily`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Daily;
}
