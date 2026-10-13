import { useEffect, useState } from "react";

/**
 * useFirstRunTheme.ts
 * 首次引导这几个页面共用的深浅色开关。
 *
 * 与登录页 / 工作台读写的是同一个键（psych_theme）：引导页切了深色，
 * 进工作台也是深色，不会出现"刚设完又跳回去"的割裂感。
 * index.html 的首屏脚本读的也是这个键，刷新不会闪白。
 */

export type FirstRunTheme = "light" | "dark";

const THEME_KEY = "psych_theme";

const readStoredTheme = (): FirstRunTheme =>
  window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";

export function useFirstRunTheme() {
  const [theme, setTheme] = useState<FirstRunTheme>(readStoredTheme);

  useEffect(() => {
    const dark = theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#0b1120" : "#465fff");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 隐私模式下 localStorage 不可写时忽略，本次会话内仍然生效 */
    }
  }, [theme]);

  /* 切换的 ~260ms 内加过渡类：整页颜色渐变而不是硬切 */
  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return { theme, toggleTheme };
}
