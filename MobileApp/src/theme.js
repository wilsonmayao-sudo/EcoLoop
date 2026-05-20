/** Shared map / route legend colors (readable on light & dark map chrome). */
export const mapPalette = {
  you: "#2563EB",
  depot: "#64748B",
  next: "#CA8A04",
  stops: "#059669",
  routeStart: "#B45309",
};

export const lightColors = {
  primary: "#38A65C",
  primaryDark: "#2E8D4D",
  headerBg: "#3DB465",
  surface: "#F8FAF8",
  card: "#FFFFFF",
  textPrimary: "#1A1C1A",
  textSecondary: "#60676A",
  success: "#319B52",
  warning: "#E9A23B",
  danger: "#DC4B3F",
  info: "#2563EB",
  borderSubtle: "rgba(26, 28, 26, 0.10)",
  /** Secondary CTA (e.g. Start route) — distinct from primary green */
  actionSecondary: "#1D6FEB",
  /** Muted / neutral CTA (e.g. Complete route) */
  actionMuted: "#5F6368",
  pillBlue: "#4A90E2",
  pillPink: "#E86AA6",
  pillGreen: "#3DB465",
  chipNextBg: "rgba(202, 138, 4, 0.14)",
  chipNextText: "#92400E",
  badge: "#DC2626",
  mapYou: mapPalette.you,
  mapDepot: mapPalette.depot,
  mapNext: mapPalette.next,
  mapStops: mapPalette.stops,
  mapRouteStart: mapPalette.routeStart,
};

export const darkColors = {
  primary: "#38A65C",
  primaryDark: "#2E8D4D",
  headerBg: "#2E8D4D",
  surface: "#121212",
  card: "#1E1E1E",
  textPrimary: "#FFFFFF",
  textSecondary: "#B0B0B0",
  success: "#4CAF50",
  warning: "#FFB74D",
  danger: "#E74C3C",
  info: "#5B9FFF",
  borderSubtle: "rgba(255, 255, 255, 0.08)",
  actionSecondary: "#5B9FFF",
  actionMuted: "#9CA3AF",
  pillBlue: "#4A90E2",
  pillPink: "#E86AA6",
  pillGreen: "#3DB465",
  chipNextBg: "rgba(251, 191, 36, 0.18)",
  chipNextText: "#FCD34D",
  badge: "#F87171",
  mapYou: mapPalette.you,
  mapDepot: "#94A3B8",
  mapNext: "#FBBF24",
  mapStops: "#34D399",
  mapRouteStart: "#FB923C",
};

/** Layout + typography tokens (not mode-dependent). */
export const designTokens = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radius: { sm: 10, md: 12, lg: 16, xl: 20, full: 999 },
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
  minTouch: 48,
  font: {
    caption: 11,
    label: 12,
    body: 14,
    bodyLarge: 15,
    title: 16,
    titleLg: 17,
    headline: 18,
    hero: 22,
    display: 28,
  },
  shadow: {
    card: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 12,
      elevation: 3,
    },
    cardRaised: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.10,
      shadowRadius: 14,
      elevation: 6,
    },
    fab: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
      elevation: 5,
    },
  },
};

// Default export for backward compatibility
export const AppColors = lightColors;
