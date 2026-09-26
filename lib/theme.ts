// Device-level theme preference: System (default), Light, Dark, Blood, AMOLED, Sugar.
// This is a UI preference, not care data, so it lives in localStorage rather than the backend.
export const THEME_STORAGE_KEY = "carby-theme";

export type ThemePreference = "system" | "light" | "dark" | "blood" | "amoled" | "sugar";
export type ResolvedTheme = "light" | "dark" | "blood" | "amoled" | "sugar";

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "blood", label: "Blood" },
  { value: "amoled", label: "AMOLED black" },
  { value: "sugar", label: "Sugar" },
];

// Matches --canvas for each theme in app/theme.css, used for <meta name="theme-color">.
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#f5f7fc",
  dark: "#0a0c11",
  blood: "#0d0606",
  amoled: "#000000",
  sugar: "#fdf3f6",
};

function isThemePreference(value: string | null): value is ThemePreference {
  return (
    value === "system" ||
    value === "light" ||
    value === "dark" ||
    value === "blood" ||
    value === "amoled" ||
    value === "sugar"
  );
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(raw) ? raw : "system";
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

/** Sets data-theme + the theme-color meta tag, and persists the preference. */
export function applyTheme(pref: ThemePreference) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
}

/**
 * Re-applies the stored preference (idempotent with the anti-flash <head> script), keeps the
 * theme live-synced with OS light/dark changes while the preference is "System", and mirrors
 * preference changes made in another tab. Returns a cleanup function.
 */
export function initThemeSync(onChange?: (pref: ThemePreference) => void): () => void {
  applyTheme(getStoredThemePreference());
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMediaChange = () => {
    if (getStoredThemePreference() === "system") applyTheme("system");
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const pref = getStoredThemePreference();
    applyTheme(pref);
    onChange?.(pref);
  };
  media.addEventListener("change", onMediaChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onMediaChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setThemePreference(pref: ThemePreference) {
  applyTheme(pref);
}
