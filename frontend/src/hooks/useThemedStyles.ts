import { useEffect, useMemo, useState } from "react";
import { onAccentChange } from "@/src/theme";

// Returns the StyleSheet produced by `factory`, and rebuilds it whenever the
// accent theme changes so both the StyleSheet and any inline colors that read
// from the shared `colors` object refresh on the next render.
export function useThemedStyles<T>(factory: () => T): T {
  const [version, setVersion] = useState(0);
  useEffect(() => onAccentChange(() => setVersion((v) => v + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(), [version]);
}
