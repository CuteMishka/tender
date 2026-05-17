import { useCallback, useEffect, useState } from "react";

export type ThemeKey = "green" | "blue" | "purple" | "orange" | "rose";
export type AppearanceMode = "light" | "dark" | "system";

export const THEMES: { key: ThemeKey; label: string; color: string }[] = [
  { key: "green", label: "Зелёная", color: "#11B273" },
  { key: "blue", label: "Синяя", color: "#3B82F6" },
  { key: "purple", label: "Фиолетовая", color: "#8B5CF6" },
  { key: "orange", label: "Оранжевая", color: "#F59E0B" },
  { key: "rose", label: "Розовая", color: "#F43F5E" },
];

const STORAGE_KEY = "tender_ui_theme";
const APPEARANCE_STORAGE_KEY = "tender_ui_appearance";

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyAppearance(mode: AppearanceMode) {
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeKey>(() => {
    if (typeof window === "undefined") return "green";
    return (localStorage.getItem(STORAGE_KEY) as ThemeKey) || "green";
  });
  const [appearance, setAppearanceState] = useState<AppearanceMode>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(APPEARANCE_STORAGE_KEY) as AppearanceMode) || "light";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAppearance(appearance);
    if (appearance !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyAppearance("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [appearance]);

  const setTheme = useCallback((key: ThemeKey) => {
    localStorage.setItem(STORAGE_KEY, key);
    setThemeState(key);
    applyTheme(key);
  }, []);

  const setAppearance = useCallback((mode: AppearanceMode) => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
    setAppearanceState(mode);
    applyAppearance(mode);
  }, []);

  return { theme, setTheme, appearance, setAppearance };
}
