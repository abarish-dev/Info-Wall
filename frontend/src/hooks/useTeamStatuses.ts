// Shared team game statuses (home team-row pills + live-score push). Refreshes
// every 30s so live scores stay current. Backend caches the scoreboard (60s).

import { useEffect, useRef, useState } from "react";
import { fetchTeamStatus, type TeamStatus } from "@/src/services/catalog";

export function useTeamStatuses(teams: string[]) {
  const [statuses, setStatuses] = useState<Record<string, TeamStatus>>({});
  const key = teams.join("|");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!teams.length) {
      setStatuses({});
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetchTeamStatus(teams);
        if (!alive) return;
        const map: Record<string, TeamStatus> = {};
        res.forEach((s) => (map[s.team.toUpperCase()] = s));
        setStatuses(map);
      } catch {
        /* keep prior */
      }
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 300);
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const liveCount = Object.values(statuses).filter(
    (s) => s.highlight === "live",
  ).length;

  return { statuses, liveCount };
}
