// Sports team catalog for the Aura matrix companion.
// Leagues the firmware fetches from ESPN's public JSON endpoints.

export type League = "NFL" | "NBA" | "MLB" | "NHL";

export type Team = {
  abbr: string; // ESPN team abbreviation
  city: string;
  name: string;
  color: string; // primary team color (hex)
};

export const LEAGUES: League[] = ["NFL", "NBA", "MLB", "NHL"];

export const LEAGUE_LABEL: Record<League, string> = {
  NFL: "Football",
  NBA: "Basketball",
  MLB: "Baseball",
  NHL: "Hockey",
};

export const TEAMS: Record<League, Team[]> = {
  NFL: [
    { abbr: "ARI", city: "Arizona", name: "Cardinals", color: "#97233A" },
    { abbr: "ATL", city: "Atlanta", name: "Falcons", color: "#A71930" },
    { abbr: "BAL", city: "Baltimore", name: "Ravens", color: "#241773" },
    { abbr: "BUF", city: "Buffalo", name: "Bills", color: "#00338D" },
    { abbr: "CAR", city: "Carolina", name: "Panthers", color: "#0085CA" },
    { abbr: "CHI", city: "Chicago", name: "Bears", color: "#0B162A" },
    { abbr: "CIN", city: "Cincinnati", name: "Bengals", color: "#FB4F14" },
    { abbr: "CLE", city: "Cleveland", name: "Browns", color: "#311D00" },
    { abbr: "DAL", city: "Dallas", name: "Cowboys", color: "#003594" },
    { abbr: "DEN", city: "Denver", name: "Broncos", color: "#FB4F14" },
    { abbr: "DET", city: "Detroit", name: "Lions", color: "#0076B6" },
    { abbr: "GB", city: "Green Bay", name: "Packers", color: "#203731" },
    { abbr: "HOU", city: "Houston", name: "Texans", color: "#03202F" },
    { abbr: "IND", city: "Indianapolis", name: "Colts", color: "#002C5F" },
    { abbr: "JAX", city: "Jacksonville", name: "Jaguars", color: "#006778" },
    { abbr: "KC", city: "Kansas City", name: "Chiefs", color: "#E31837" },
    { abbr: "LV", city: "Las Vegas", name: "Raiders", color: "#000000" },
    { abbr: "LAC", city: "Los Angeles", name: "Chargers", color: "#0080C6" },
    { abbr: "LAR", city: "Los Angeles", name: "Rams", color: "#003594" },
    { abbr: "MIA", city: "Miami", name: "Dolphins", color: "#008E97" },
    { abbr: "MIN", city: "Minnesota", name: "Vikings", color: "#4F2683" },
    { abbr: "NE", city: "New England", name: "Patriots", color: "#002244" },
    { abbr: "NO", city: "New Orleans", name: "Saints", color: "#D3BC8D" },
    { abbr: "NYG", city: "New York", name: "Giants", color: "#0B2265" },
    { abbr: "NYJ", city: "New York", name: "Jets", color: "#125740" },
    { abbr: "PHI", city: "Philadelphia", name: "Eagles", color: "#004C54" },
    { abbr: "PIT", city: "Pittsburgh", name: "Steelers", color: "#FFB612" },
    { abbr: "SF", city: "San Francisco", name: "49ers", color: "#AA0000" },
    { abbr: "SEA", city: "Seattle", name: "Seahawks", color: "#002244" },
    { abbr: "TB", city: "Tampa Bay", name: "Buccaneers", color: "#D50A0A" },
    { abbr: "TEN", city: "Tennessee", name: "Titans", color: "#0C2340" },
    { abbr: "WSH", city: "Washington", name: "Commanders", color: "#5A1414" },
  ],
  NBA: [
    { abbr: "ATL", city: "Atlanta", name: "Hawks", color: "#E03A3E" },
    { abbr: "BOS", city: "Boston", name: "Celtics", color: "#007A33" },
    { abbr: "BKN", city: "Brooklyn", name: "Nets", color: "#000000" },
    { abbr: "CHA", city: "Charlotte", name: "Hornets", color: "#1D1160" },
    { abbr: "CHI", city: "Chicago", name: "Bulls", color: "#CE1141" },
    { abbr: "CLE", city: "Cleveland", name: "Cavaliers", color: "#860038" },
    { abbr: "DAL", city: "Dallas", name: "Mavericks", color: "#00538C" },
    { abbr: "DEN", city: "Denver", name: "Nuggets", color: "#0E2240" },
    { abbr: "DET", city: "Detroit", name: "Pistons", color: "#C8102E" },
    { abbr: "GS", city: "Golden State", name: "Warriors", color: "#1D428A" },
    { abbr: "HOU", city: "Houston", name: "Rockets", color: "#CE1141" },
    { abbr: "IND", city: "Indiana", name: "Pacers", color: "#002D62" },
    { abbr: "LAC", city: "LA", name: "Clippers", color: "#C8102E" },
    { abbr: "LAL", city: "Los Angeles", name: "Lakers", color: "#552583" },
    { abbr: "MEM", city: "Memphis", name: "Grizzlies", color: "#5D76A9" },
    { abbr: "MIA", city: "Miami", name: "Heat", color: "#98002E" },
    { abbr: "MIL", city: "Milwaukee", name: "Bucks", color: "#00471B" },
    { abbr: "MIN", city: "Minnesota", name: "Timberwolves", color: "#0C2340" },
    { abbr: "NO", city: "New Orleans", name: "Pelicans", color: "#0C2340" },
    { abbr: "NY", city: "New York", name: "Knicks", color: "#006BB6" },
    { abbr: "OKC", city: "Oklahoma City", name: "Thunder", color: "#007AC1" },
    { abbr: "ORL", city: "Orlando", name: "Magic", color: "#0077C0" },
    { abbr: "PHI", city: "Philadelphia", name: "76ers", color: "#006BB6" },
    { abbr: "PHX", city: "Phoenix", name: "Suns", color: "#1D1160" },
    { abbr: "POR", city: "Portland", name: "Trail Blazers", color: "#E03A3E" },
    { abbr: "SAC", city: "Sacramento", name: "Kings", color: "#5A2D81" },
    { abbr: "SA", city: "San Antonio", name: "Spurs", color: "#8A8D8F" },
    { abbr: "TOR", city: "Toronto", name: "Raptors", color: "#CE1141" },
    { abbr: "UTAH", city: "Utah", name: "Jazz", color: "#002B5C" },
    { abbr: "WSH", city: "Washington", name: "Wizards", color: "#002B5C" },
  ],
  MLB: [
    { abbr: "ARI", city: "Arizona", name: "Diamondbacks", color: "#A71930" },
    { abbr: "ATL", city: "Atlanta", name: "Braves", color: "#CE1141" },
    { abbr: "BAL", city: "Baltimore", name: "Orioles", color: "#DF4601" },
    { abbr: "BOS", city: "Boston", name: "Red Sox", color: "#BD3039" },
    { abbr: "CHC", city: "Chicago", name: "Cubs", color: "#0E3386" },
    { abbr: "CHW", city: "Chicago", name: "White Sox", color: "#27251F" },
    { abbr: "CIN", city: "Cincinnati", name: "Reds", color: "#C6011F" },
    { abbr: "CLE", city: "Cleveland", name: "Guardians", color: "#00385D" },
    { abbr: "COL", city: "Colorado", name: "Rockies", color: "#333366" },
    { abbr: "DET", city: "Detroit", name: "Tigers", color: "#0C2340" },
    { abbr: "HOU", city: "Houston", name: "Astros", color: "#EB6E1F" },
    { abbr: "KC", city: "Kansas City", name: "Royals", color: "#004687" },
    { abbr: "LAA", city: "Los Angeles", name: "Angels", color: "#BA0021" },
    { abbr: "LAD", city: "Los Angeles", name: "Dodgers", color: "#005A9C" },
    { abbr: "MIA", city: "Miami", name: "Marlins", color: "#00A3E0" },
    { abbr: "MIL", city: "Milwaukee", name: "Brewers", color: "#12284B" },
    { abbr: "MIN", city: "Minnesota", name: "Twins", color: "#002B5C" },
    { abbr: "NYM", city: "New York", name: "Mets", color: "#FF5910" },
    { abbr: "NYY", city: "New York", name: "Yankees", color: "#003087" },
    { abbr: "OAK", city: "Oakland", name: "Athletics", color: "#003831" },
    { abbr: "PHI", city: "Philadelphia", name: "Phillies", color: "#E81828" },
    { abbr: "PIT", city: "Pittsburgh", name: "Pirates", color: "#FDB827" },
    { abbr: "SD", city: "San Diego", name: "Padres", color: "#2F241D" },
    { abbr: "SF", city: "San Francisco", name: "Giants", color: "#FD5A1E" },
    { abbr: "SEA", city: "Seattle", name: "Mariners", color: "#0C2C56" },
    { abbr: "STL", city: "St. Louis", name: "Cardinals", color: "#C41E3A" },
    { abbr: "TB", city: "Tampa Bay", name: "Rays", color: "#092C5C" },
    { abbr: "TEX", city: "Texas", name: "Rangers", color: "#003278" },
    { abbr: "TOR", city: "Toronto", name: "Blue Jays", color: "#134A8E" },
    { abbr: "WSH", city: "Washington", name: "Nationals", color: "#AB0003" },
  ],
  NHL: [
    { abbr: "ANA", city: "Anaheim", name: "Ducks", color: "#F47A38" },
    { abbr: "BOS", city: "Boston", name: "Bruins", color: "#FFB81C" },
    { abbr: "BUF", city: "Buffalo", name: "Sabres", color: "#003087" },
    { abbr: "CGY", city: "Calgary", name: "Flames", color: "#C8102E" },
    { abbr: "CAR", city: "Carolina", name: "Hurricanes", color: "#CC0000" },
    { abbr: "CHI", city: "Chicago", name: "Blackhawks", color: "#CF0A2C" },
    { abbr: "COL", city: "Colorado", name: "Avalanche", color: "#6F263D" },
    { abbr: "CBJ", city: "Columbus", name: "Blue Jackets", color: "#002654" },
    { abbr: "DAL", city: "Dallas", name: "Stars", color: "#006847" },
    { abbr: "DET", city: "Detroit", name: "Red Wings", color: "#CE1126" },
    { abbr: "EDM", city: "Edmonton", name: "Oilers", color: "#FF4C00" },
    { abbr: "FLA", city: "Florida", name: "Panthers", color: "#041E42" },
    { abbr: "LA", city: "Los Angeles", name: "Kings", color: "#A2AAAD" },
    { abbr: "MIN", city: "Minnesota", name: "Wild", color: "#154734" },
    { abbr: "MTL", city: "Montreal", name: "Canadiens", color: "#AF1E2D" },
    { abbr: "NSH", city: "Nashville", name: "Predators", color: "#FFB81C" },
    { abbr: "NJ", city: "New Jersey", name: "Devils", color: "#CE1126" },
    { abbr: "NYI", city: "New York", name: "Islanders", color: "#00539B" },
    { abbr: "NYR", city: "New York", name: "Rangers", color: "#0038A8" },
    { abbr: "OTT", city: "Ottawa", name: "Senators", color: "#C52032" },
    { abbr: "PHI", city: "Philadelphia", name: "Flyers", color: "#F74902" },
    { abbr: "PIT", city: "Pittsburgh", name: "Penguins", color: "#FCB514" },
    { abbr: "SJ", city: "San Jose", name: "Sharks", color: "#006D75" },
    { abbr: "SEA", city: "Seattle", name: "Kraken", color: "#68A2B9" },
    { abbr: "STL", city: "St. Louis", name: "Blues", color: "#002F87" },
    { abbr: "TB", city: "Tampa Bay", name: "Lightning", color: "#002868" },
    { abbr: "TOR", city: "Toronto", name: "Maple Leafs", color: "#00205B" },
    { abbr: "VAN", city: "Vancouver", name: "Canucks", color: "#00205B" },
    { abbr: "VGK", city: "Vegas", name: "Golden Knights", color: "#B4975A" },
    { abbr: "WSH", city: "Washington", name: "Capitals", color: "#C8102E" },
    { abbr: "WPG", city: "Winnipeg", name: "Jets", color: "#041E42" },
  ],
};

export function findTeam(league: League, abbr: string): Team | undefined {
  return TEAMS[league].find((t) => t.abbr === abbr);
}

/** ESPN CDN logo for a team (may 404 for a few abbreviations). */
export function teamLogoUrl(league: League, abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/${league.toLowerCase()}/500/${abbr.toLowerCase()}.png`;
}

/** Pick readable foreground (black/white) for a given hex background. */
export function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}
