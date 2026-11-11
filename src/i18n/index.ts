/**
 * The app's text. Every string a person reads comes from a locale under
 * `./locales/<language>/`; components read it with `useTranslation()`,
 * other modules with `t` from here. English is the source and the
 * fallback: a key missing from another language shows the English text.
 *
 * To add a language: copy `locales/en/` to `locales/<code>/`, translate
 * the values, and list it in `resources` below.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";

export const DEFAULT_LANGUAGE = "en";

export const resources = {
  en: { translation: en },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  // React escapes what it renders; escaping here too would double it.
  interpolation: { escapeValue: false },
  returnNull: false,
  // The resources are bundled, so the first render already has them.
  initAsync: false,
});

// Screen readers and the browser's own hyphenation and fonts follow <html lang>.
function markDocumentLanguage(language: string) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
markDocumentLanguage(i18n.language);
i18n.on("languageChanged", markDocumentLanguage);

export const t = i18n.t.bind(i18n);

const base = (tag: string) => tag.toLowerCase().split("-")[0];

/**
 * The locale for dates and numbers (`Intl`, `toLocaleString`). It is the
 * system's own, with its regional habits (24-hour time, day before month),
 * unless the person chose a language other than their system's: then it is
 * that language. A system language the app has no text for keeps its own
 * formats, as it did before the app had languages.
 */
export function currentLocale(): string {
  const language = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANGUAGE;
  const system = typeof navigator !== "undefined" ? navigator.language : "";
  if (!system) return language;
  const translated = Object.keys(resources).some((code) => base(code) === base(system));
  return base(system) === base(language) || !translated ? system : language;
}

export default i18n;
