import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage === "ar" ? "ar" : "en";

  return (
    <>
      <label className="sr-only" htmlFor="language-switcher">
        {t("controls.language")}
      </label>
      <select
        aria-label={t("controls.language")}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        id="language-switcher"
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        value={language}
      >
        <option value="en">{t("controls.english")}</option>
        <option value="ar">{t("controls.arabic")}</option>
      </select>
    </>
  );
}
