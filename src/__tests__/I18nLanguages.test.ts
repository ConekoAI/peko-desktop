import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LANGUAGES, matchLanguage } from "../i18n/languages";

/**
 * Every language says everything English says. For each language in
 * `LANGUAGES` this checks its files against `locales/en/`:
 *
 * - the same files and the same keys, none missing and none left over;
 * - the same `{{values}}` and `<tags>` in each string, so nothing a
 *   sentence needs is dropped or misspelled in translation;
 * - for a counted string, every plural form the language has.
 */

const LOCALES = join(__dirname, "..", "i18n", "locales");
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Flat = Record<string, string>;

function flatten(value: unknown, path: string, out: Flat): Flat {
  if (typeof value === "string") out[path] = value;
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

function readLanguage(code: string): Flat {
  const dir = join(LOCALES, code);
  const out: Flat = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    flatten(JSON.parse(readFileSync(join(dir, file), "utf8")), file.slice(0, -5), out);
  }
  return out;
}

/** The `{{values}}` and `<tags>` a string carries, in a stable order. */
function slots(text: string): string {
  const values = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => `{{${m[1]}}}`);
  const tags = [...text.matchAll(/<\/?(\w+)\s*\/?>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...values, ...tags])].sort().join(" ");
}

/** A key without its plural form: `minutesAgo_one` → `minutesAgo`. */
const stem = (key: string) => key.replace(PLURAL, "");

const english = readLanguage("en");
const englishStems = new Set(Object.keys(english).map(stem));
/** Stems English writes in plural forms. */
const counted = new Set(Object.keys(english).filter((k) => PLURAL.test(k)).map(stem));

describe("matchLanguage", () => {
  it("serves a regional tag with the language the app has", () => {
    expect(matchLanguage("fr-CA")).toBe("fr");
    expect(matchLanguage("pt-PT")).toBe("pt-BR");
    expect(matchLanguage("en-GB")).toBe("en");
    expect(matchLanguage("JA")).toBe("ja");
  });

  it("tells Chinese apart by script", () => {
    expect(matchLanguage("zh")).toBe("zh-CN");
    expect(matchLanguage("zh-SG")).toBe("zh-CN");
    expect(matchLanguage("zh-Hans-HK")).toBe("zh-CN");
    expect(matchLanguage("zh-HK")).toBe("zh-TW");
    expect(matchLanguage("zh-Hant")).toBe("zh-TW");
    expect(matchLanguage("zh-TW")).toBe("zh-TW");
  });

  it("has nothing for a language the app has no text for", () => {
    expect(matchLanguage("sw")).toBeNull();
  });
});

describe.each(LANGUAGES.filter((l) => l.code !== "en"))("$name ($code)", ({ code }) => {
  it("has its files", () => {
    expect(existsSync(join(LOCALES, code))).toBe(true);
    const files = (dir: string) => readdirSync(join(LOCALES, dir)).filter((f) => f.endsWith(".json")).sort();
    expect(files(code)).toEqual(files("en"));
  });

  it("says everything English says, and nothing else", () => {
    const stems = new Set(Object.keys(readLanguage(code)).map(stem));
    expect([...englishStems].filter((k) => !stems.has(k))).toEqual([]);
    expect([...stems].filter((k) => !englishStems.has(k))).toEqual([]);
  });

  it("has every plural form the language uses", () => {
    const translated = readLanguage(code);
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    const missing: string[] = [];
    for (const key of counted) {
      for (const form of forms) {
        if (!(`${key}_${form}` in translated)) missing.push(`${key}_${form}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps each string's values and tags", () => {
    const translated = readLanguage(code);
    const wrong: string[] = [];
    for (const [key, text] of Object.entries(translated)) {
      // A plural form is checked against English's general form.
      const source = english[key] ?? english[`${stem(key)}_other`];
      if (source === undefined) continue;
      // A form for exactly one may spell the number out and drop {{count}}.
      const expected = slots(source);
      const actual = slots(text);
      const oneForm = /_(one|zero|two)$/.test(key);
      const ok = oneForm
        ? actual === expected || actual === expected.replace("{{count}}", "").replace(/\s+/g, " ").trim()
        : actual === expected;
      if (!ok) wrong.push(`${key}: expected [${expected}] got [${actual}]`);
    }
    expect(wrong).toEqual([]);
  });

  it("leaves no string empty", () => {
    const empty = Object.entries(readLanguage(code))
      .filter(([, text]) => text.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});
