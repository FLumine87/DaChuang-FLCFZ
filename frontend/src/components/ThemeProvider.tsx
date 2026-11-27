import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ThemeContext, type Theme } from "../hooks/useTheme";

type ThemeMode = "system" | Theme;

// index.html 使用相同的存储键和媒体查询，在首屏渲染前应用主题。
const THEME_MODE_KEY = "psych_theme_mode";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function readThemeMode(): ThemeMode {
  try {
    const mode = window.localStorage.getItem(THEME_MODE_KEY);
    if (mode === "light" || mode === "dark") return mode;
  } catch {
    // 浏览器限制存储时，仍然可以跟随系统主题。
  }
  return "system";
}

function readSystemTheme(): Theme {
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(readThemeMode);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme);
  const theme = mode === "system" ? systemTheme : mode;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const dark = theme === "dark";
    const switching = root.classList.contains("dark") !== dark;
    root.classList.toggle("theme-switching", switching);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#0b1120" : "#465fff");

    if (!switching) return;
    const timer = window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    return () => {
      window.clearTimeout(timer);
      root.classList.remove("theme-switching");
    };
  }, [theme]);

  const settings = useMemo(() => {
    const changeMode = (nextMode: ThemeMode) => {
      setMode(nextMode);
      try {
        window.localStorage.setItem(THEME_MODE_KEY, nextMode);
      } catch {
        // 浏览器限制存储时，设置仍在当前会话中生效。
      }
    };
    return {
      theme,
      followSystem: mode === "system",
      setFollowSystem: (enabled: boolean) => changeMode(enabled ? "system" : theme),
      toggleTheme: () => changeMode(theme === "dark" ? "light" : "dark"),
    };
  }, [mode, theme]);

  return <ThemeContext.Provider value={settings}>{children}</ThemeContext.Provider>;
}
