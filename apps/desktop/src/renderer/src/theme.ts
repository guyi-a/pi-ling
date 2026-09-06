import type { AppTheme } from "@pi-ling/contracts";

const THEME_STORAGE_KEY = "pi-ling.theme";

export function resolveInitialTheme(options: {
  search: string;
  storedTheme: string | null;
  prefersDark: boolean;
}): AppTheme {
  const fixtureTheme = new URLSearchParams(options.search).get("theme");
  if (fixtureTheme === "dark" || fixtureTheme === "light") {
    return fixtureTheme;
  }
  if (options.storedTheme === "dark" || options.storedTheme === "light") {
    return options.storedTheme;
  }
  return options.prefersDark ? "dark" : "light";
}

export function readInitialTheme(): AppTheme {
  return resolveInitialTheme({
    search: window.location.search,
    storedTheme: window.localStorage.getItem(THEME_STORAGE_KEY),
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
}

export function applyTheme(theme: AppTheme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}
