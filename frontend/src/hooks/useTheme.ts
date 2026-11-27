import { createContext, useContext } from "react";

export type Theme = "light" | "dark";

interface ThemeSettings {
  theme: Theme;
  followSystem: boolean;
  setFollowSystem: (enabled: boolean) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeSettings | null>(null);

export function useTheme() {
  const settings = useContext(ThemeContext);
  if (!settings) throw new Error("useTheme must be used within ThemeProvider");
  return settings;
}
