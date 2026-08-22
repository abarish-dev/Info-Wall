// Primary colors keyed by common team abbreviation across the 4 major US
// leagues (NFL / MLB / NBA / NHL). Used for the colored badge shown next to
// each team input. Where an abbreviation is shared by teams in different
// leagues (e.g. CAR), one representative color is chosen. Unknown abbreviations
// get a deterministic color derived from the text so every team is distinct.

const TEAM_BG: Record<string, string> = {
  // NFL
  ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
  CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00",
  DAL: "#003594", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
  HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837",
  LV: "#111111", LAC: "#0080C6", LAR: "#003594", MIA: "#008E97",
  MIN: "#4F2683", NE: "#002244", NO: "#9F8958", NYG: "#0B2265",
  NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SF: "#AA0000",
  SEA: "#002244", TB: "#D50A0A", TEN: "#4B92DB", WAS: "#5A1414",
  // MLB (abbreviations not already used above)
  BOS: "#BD3039", CHC: "#0E3386", CWS: "#27251F", COL: "#333366",
  LAA: "#BA0021", LAD: "#005A9C", MIL: "#12284B", NYM: "#002D72",
  NYY: "#0C2340", OAK: "#003831", SD: "#2F241D", STL: "#C41E3A",
  TEX: "#003278", TOR: "#134A8E", WSH: "#AB0003",
  // NBA
  BKN: "#111111", CHA: "#1D1160", GSW: "#1D428A", LAL: "#552583",
  MEM: "#5D76A9", NOP: "#0C2340", NYK: "#006BB6", OKC: "#007AC1",
  ORL: "#0077C0", PHX: "#1D1160", POR: "#E03A3E", SAC: "#5A2D81",
  SAS: "#8A8D8F", UTA: "#002B5C",
  // NHL
  ANA: "#F47A38", CGY: "#C8102E", CBJ: "#002654", EDM: "#FF4C00",
  FLA: "#041E42", LAK: "#111111", MTL: "#AF1E2D", NSH: "#FFB81C",
  NJD: "#CE1126", NYI: "#00539B", NYR: "#0038A8", OTT: "#C52032",
  SJS: "#006D75", TBL: "#002868", VAN: "#00205B", VGK: "#B4975A",
  WPG: "#041E42",
};

function hslToHex(h: number, s: number, l: number): string {
  const a = (s * Math.min(l, 100 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - (a / 100) * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffff;
  return hslToHex(h % 360, 52, 40);
}

// White or near-black text depending on background luminance.
function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#FFFFFF";
}

export type TeamBadge = { bg: string; fg: string; known: boolean };

export function getTeamBadge(abbr: string): TeamBadge {
  const key = abbr.trim().toUpperCase();
  const known = key.length > 0 && key in TEAM_BG;
  const bg = known ? TEAM_BG[key] : hashColor(key || "??");
  return { bg, fg: contrastText(bg), known };
}
