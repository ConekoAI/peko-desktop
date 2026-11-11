/**
 * The app's text. Every string a person reads comes from a locale under
 * `./locales/<language>/`; components read it with `useTranslation()`,
 * other modules with `t` from here. English is the source and the
 * fallback: a key missing from another language shows the English text.
 *
 * English is bundled, so the first render always has text. Any other
 * language is loaded when it is first shown.
 *
 * To add a language: copy `locales/en/*.json` to `locales/<code>/`,
 * translate the values, and list it in `LANGUAGES` (`./languages.ts`).
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  baseOf,
  getLanguageChoice,
  resolveLanguage,
  storeLanguageChoice,
  type LanguageChoice,
  type LanguageCode,
} from "./languages";

export * from "./languages";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  // React escapes what it renders; escaping here too would double it.
  interpolation: { escapeValue: false },
  returnNull: false,
  // English is bundled, so the first render already has it.
  initAsync: false,
});

// Screen readers and the browser's own hyphenation and fonts follow <html lang>.
function markDocumentLanguage(language: string) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
markDocumentLanguage(i18n.language);
i18n.on("languageChanged", markDocumentLanguage);

export const t = i18n.t.bind(i18n);

/** Every other language's files, each fetched only when its language is shown. */
const LOCALE_FILES = import.meta.glob<{ default: unknown }>([
  "./locales/*/*.json",
  "!./locales/en/*.json",
]);

async function loadLanguage(code: LanguageCode): Promise<void> {
  if (i18n.hasResourceBundle(code, "translation")) return;
  const prefix = `./locales/${code}/`;
  const bundle: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(LOCALE_FILES)
      .filter(([path]) => path.startsWith(prefix))
      .map(async ([path, load]) => {
        bundle[path.slice(prefix.length, -".json".length)] = (await load()).default;
      }),
  );
  i18n.addResourceBundle(code, "translation", bundle, true, true);
}

/** The language on screen. */
export function currentLanguage(): LanguageCode {
  const shown = i18n.resolvedLanguage ?? i18n.language;
  return LANGUAGES.find((l) => l.code === shown)?.code ?? DEFAULT_LANGUAGE;
}

async function show(code: LanguageCode): Promise<void> {
  try {
    await loadLanguage(code);
    await i18n.changeLanguage(code);
  } catch {
    // Its files could not be read: stay in the language on screen.
  }
}

/** Show the stored pick, or the system's language. Call once, before the first render. */
export function initLanguage(): Promise<void> {
  return show(resolveLanguage(getLanguageChoice()));
}

/** Remember a pick and show it. */
export function setLanguage(choice: LanguageChoice): Promise<void> {
  storeLanguageChoice(choice);
  return show(resolveLanguage(choice));
}

/**
 * The locale for dates and numbers (`Intl`, `toLocaleString`). It is the
 * system's own, with its regional habits (24-hour time, day before month),
 * unless the app shows a language other than the system's: then it is
 * that language. A system language the app has no text for keeps its own
 * formats.
 */
export function currentLocale(): string {
  const language = currentLanguage();
  const system = typeof navigator !== "undefined" ? navigator.language : "";
  if (!system) return language;
  const translated = LANGUAGES.some((l) => baseOf(l.code) === baseOf(system));
  return baseOf(system) === baseOf(language) || !translated ? system : language;
}

export default i18n;
