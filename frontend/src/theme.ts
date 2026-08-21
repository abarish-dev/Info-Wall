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
} as const;

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
} as const;
