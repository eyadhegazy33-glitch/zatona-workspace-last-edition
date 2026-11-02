import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const themeStorageKey = "elzatona-theme";

function getInitialTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "dark";
  } catch {
    return document.documentElement.classList.contains("dark");
  }
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem(themeStorageKey, isDark ? "dark" : "light");
    } catch {
      // The theme still applies for the current session.
    }
  }, [isDark]);

  return (
    <button
      aria-label={isDark ? t("controls.lightMode") : t("controls.darkMode")}
      className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-ink transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      onClick={() => setIsDark((current) => !current)}
      type="button"
    >
      {isDark ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
    </button>
  );
}
