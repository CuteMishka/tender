import { useCallback, useEffect, useState } from "react";

export type ThemeKey = "green" | "blue" | "purple" | "orange" | "rose";

export const THEMES: { key: ThemeKey; label: string; color: string }[] = [
  { key: "green", label: "Зелёная", color: "#11B273" },
  { key: "blue", label: "Синяя", color: "#3B82F6" },
  { key: "purple", label: "Фиолетовая", color: "#8B5CF6" },
  { key: "orange", label: "Оранжевая", color: "#F59E0B" },
  { key: "rose", label: "Розовая", color: "#F43F5E" },
];

const STORAGE_KEY = "tender_ui_theme";

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeKey>(() => {
    if (typeof window === "undefined") return "green";
    return (localStorage.getItem(STORAGE_KEY) as ThemeKey) || "green";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((key: ThemeKey) => {
    localStorage.setItem(STORAGE_KEY, key);
    setThemeState(key);
    applyTheme(key);
  }, []);

  return { theme, setTheme };
}
