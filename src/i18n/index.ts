import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar/translation.json";
import en from "./locales/en/translation.json";

const languageStorageKey = "elzatona-language";
let storedLanguage: string | null = null;

try {
  storedLanguage = localStorage.getItem(languageStorageKey);
} catch {
  // Use English when browser storage is unavailable.
}
const initialLanguage = storedLanguage === "ar" ? "ar" : "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

const updateDocumentLanguage = (language: string) => {
  const normalizedLanguage = language === "ar" ? "ar" : "en";
  document.documentElement.lang = normalizedLanguage;
  document.documentElement.dir = normalizedLanguage === "ar" ? "rtl" : "ltr";
  try {
    localStorage.setItem(languageStorageKey, normalizedLanguage);
  } catch {
    // Language selection still works for the current session.
  }
};

updateDocumentLanguage(initialLanguage);
i18n.on("languageChanged", updateDocumentLanguage);

export default i18n;
