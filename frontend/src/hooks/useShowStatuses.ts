// Shared TV-show release statuses (used by the home badge + the TV section)
// so we fetch once. Backend caches for an hour, so this is cheap.

import { useEffect, useRef, useState } from "react";
import { fetchShowStatus, type ShowStatus } from "@/src/services/catalog";

export function useShowStatuses(shows: string[]) {
  const [statuses, setStatuses] = useState<Record<string, ShowStatus>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = shows.join("|");

  useEffect(() => {
    if (!shows.length) {
      setStatuses({});
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetchShowStatus(shows);
        const map: Record<string, ShowStatus> = {};
        res.forEach((s) => (map[s.name.toLowerCase()] = s));
        setStatuses(map);
      } catch {
        /* keep prior */
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const newTodayCount = Object.values(statuses).filter(
    (s) => s.highlight === "new",
  ).length;

  return { statuses, newTodayCount };
}
