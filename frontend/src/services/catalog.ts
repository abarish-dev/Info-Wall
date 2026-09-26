// Backend-proxied lookups: stock-symbol verification (Yahoo Finance) and
// TV show search + release status (TVmaze). All keyless, via our FastAPI.

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type TickerResult = {
  symbol: string;
  valid: boolean | null; // null = couldn't verify (network)
  name: string | null;
  exchange: string | null;
  type: string | null;
};

export async function verifyTickers(symbols: string[]): Promise<TickerResult[]> {
  const q = symbols.filter(Boolean).join(",");
  if (!q) return [];
  const r = await fetch(
    `${BASE}/api/tickers/verify?symbols=${encodeURIComponent(q)}`,
  );
  if (!r.ok) throw new Error("verify failed");
  return (await r.json()).results ?? [];
}

export type ShowSearchItem = {
  id: number;
  name: string;
  status: string | null;
  premiered: string | null;
  year: string | null;
  network: string | null;
  genres: string[];
  image: string | null;
  imdb: string | null;
};

export async function searchShows(q: string): Promise<ShowSearchItem[]> {
  if (!q.trim()) return [];
  const r = await fetch(`${BASE}/api/tv/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error("search failed");
  return (await r.json()).results ?? [];
}

export type ShowHighlight =
  | "new"
  | "soon"
  | "returning"
  | "between"
  | "ended"
  | "unknown"
  | "none";

export type ShowStatus = {
  name: string;
  matchedName: string | null;
  status: string | null;
  highlight: ShowHighlight;
  label: string | null;
  nextAirdate: string | null;
  image: string | null;
  imdb: string | null;
};

export async function fetchShowStatus(names: string[]): Promise<ShowStatus[]> {
  const list = names.filter(Boolean);
  if (!list.length) return [];
  const q = list.join("|");
  const r = await fetch(`${BASE}/api/tv/status?names=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error("status failed");
  return (await r.json()).results ?? [];
}
