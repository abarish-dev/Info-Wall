// Design tokens for MatrixControl — Dark-First Utility / hardware command-center.
// Sourced from /app/design_guidelines.json. Ember (#FF6B00) + Obsidian palette.

export const colors = {
  surface: "#121212",
  onSurface: "#F9FAFB",
  surfaceSecondary: "#1A1A1A",
  onSurfaceSecondary: "#E5E7EB",
  surfaceTertiary: "#262626",
  onSurfaceTertiary: "#D1D5DB",
  brand: "#FF6B00",
  onBrand: "#111827",
  brandSecondary: "#E25A24",
  brandTertiary: "#4A2511",
  onBrandTertiary: "#FFB380",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#9CA3AF",
  border: "#374151",
  borderStrong: "#FF6B00",
  divider: "#262626",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

// Font family keys — must match the names registered in _layout.tsx useFonts().
export const fonts = {
  display: "Rajdhani",
  displayMedium: "Rajdhani-Medium",
  text: "IBMPlexSans",
  textMedium: "IBMPlexSans-Medium",
  mono: "SpaceMono",
} as const;

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
} as const;

// ---------------------------------------------------------------------------
// Runtime accent theming.
// `colors.brand` (+ its shades) is mutated in place when the user picks a
// theme. Style factories re-run via the rebuild registry so both static
// StyleSheets and inline JSX colors pick up the new accent on the next render.
// ---------------------------------------------------------------------------

export type AccentId = "orange" | "blue" | "red" | "gray";

export const ACCENTS: Record<
  AccentId,
  {
    label: string;
    brand: string;
    brandSecondary: string;
    brandTertiary: string;
    onBrand: string;
    onBrandTertiary: string;
  }
> = {
  orange: {
    label: "Ember",
    brand: "#FF6B00",
    brandSecondary: "#E25A24",
    brandTertiary: "#4A2511",
    onBrand: "#111827",
    onBrandTertiary: "#FFB380",
  },
  blue: {
    label: "Azure",
    brand: "#2F6FED",
    brandSecondary: "#2457C5",
    brandTertiary: "#12233F",
    onBrand: "#FFFFFF",
    onBrandTertiary: "#AFC6F5",
  },
  red: {
    label: "Crimson",
    brand: "#E5484D",
    brandSecondary: "#C13B40",
    brandTertiary: "#3E1719",
    onBrand: "#FFFFFF",
    onBrandTertiary: "#F3A6A8",
  },
  gray: {
    label: "Slate",
    brand: "#8A8F98",
    brandSecondary: "#6E727A",
    brandTertiary: "#26292E",
    onBrand: "#111827",
    onBrandTertiary: "#C7CAD0",
  },
};

const rebuilders = new Set<() => void>();

/** Register a style-factory rebuild callback; returns an unsubscribe fn. */
export function onAccentChange(fn: () => void): () => void {
  rebuilders.add(fn);
  return () => rebuilders.delete(fn);
}

/** Mutate the shared `colors` accent fields and rebuild all registered styles. */
export function applyAccent(id: AccentId): void {
  const a = ACCENTS[id] ?? ACCENTS.orange;
  Object.assign(colors as Record<string, string>, {
    brand: a.brand,
    brandSecondary: a.brandSecondary,
    brandTertiary: a.brandTertiary,
    onBrand: a.onBrand,
    onBrandTertiary: a.onBrandTertiary,
    borderStrong: a.brand,
  });
  rebuilders.forEach((fn) => fn());
}
