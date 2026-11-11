/**
 * The languages the app has text for, each under `./locales/<code>/`.
 * `name` is the language's own name for itself, which is how the picker
 * lists it whatever language is showing.
 */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "ru", name: "Русский" },
  { code: "it", name: "Italiano" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** What the person picked: one language, or whatever their system uses. */
export type LanguageChoice = LanguageCode | "system";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

const LANGUAGE_KEY = "peko-language";

const CODES = LANGUAGES.map((l) => l.code) as readonly LanguageCode[];

/** The language part of a tag: `pt-BR` → `pt`. */
export const baseOf = (tag: string) => tag.toLowerCase().split("-")[0];

/**
 * The app language that serves a system language tag (`fr-CA` → `fr`,
 * `pt-PT` → `pt-BR`), or `null` when the app has no text for it.
 *
 * Chinese is told apart by script, not region: Taiwan, Hong Kong, Macau
 * and anything marked `Hant` read Traditional; the rest read Simplified.
 */
export function matchLanguage(tag: string): LanguageCode | null {
  const lower = tag.toLowerCase();
  const exact = CODES.find((code) => code.toLowerCase() === lower);
  if (exact) return exact;
  if (baseOf(lower) === "zh") {
    if (lower.includes("hans")) return "zh-CN";
    return /hant|-tw|-hk|-mo/.test(lower) ? "zh-TW" : "zh-CN";
  }
  return CODES.find((code) => baseOf(code) === baseOf(lower)) ?? null;
}

/** The first of the system's preferred languages the app has text for, else English. */
export function systemLanguage(): LanguageCode {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const match = tag ? matchLanguage(tag) : null;
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

/** The stored pick; "system" until the person chooses a language. */
export function getLanguageChoice(): LanguageChoice {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored && (CODES as readonly string[]).includes(stored)) return stored as LanguageCode;
  } catch {
    // No storage: follow the system.
  }
  return "system";
}

export function storeLanguageChoice(choice: LanguageChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, choice);
  } catch {
    // A full or unavailable store only forgets the pick.
  }
}

/** The language a choice shows the app in. */
export function resolveLanguage(choice: LanguageChoice): LanguageCode {
  return choice === "system" ? systemLanguage() : choice;
}
