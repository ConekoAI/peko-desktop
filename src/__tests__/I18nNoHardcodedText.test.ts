import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { en } from "../i18n/locales/en";

/**
 * Text a person reads comes from `src/i18n/locales/` (see `src/i18n`), so
 * the app can be shown in another language. This test reads every
 * component and fails on text written straight into the markup: words
 * between tags, in the attributes people read or hear (`placeholder`,
 * `title`, `aria-label`, `alt`, `label`), or as a string inside `{…}`.
 *
 * A string that is not for translating (a sample value in a placeholder,
 * a product name) goes in `ALLOWED` with the reason.
 */

const SRC = join(__dirname, "..");
const SKIP_DIRS = new Set(["__tests__", "dev", "i18n", "assets", "styles"]);
const TEXT_ATTRIBUTES = new Set(["placeholder", "title", "aria-label", "alt", "label"]);

const ALLOWED = new Set([
  // Product names.
  "Peko",
  "PekoHub",
  // Sample values shown as placeholders.
  "https://api.example.com/v1",
  "https://api.pekohub.ai",
  "https://pekohub.ai/g/…",
  "~/.peko/alice.peko",
  "@owner/name",
  "team",
]);

/** Two letters in a row: a word, not punctuation or a symbol. */
const WORD = /\p{L}{2,}/u;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function isReadable(text: string): boolean {
  const trimmed = text.trim();
  return WORD.test(trimmed) && !ALLOWED.has(trimmed);
}

/** A string that only picks between cases, never shown: `a === "x"`, `case "x"`, `typeof`. */
function isComparison(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isCaseClause(parent)) return true;
  if (!ts.isBinaryExpression(parent)) return false;
  const op = parent.operatorToken.kind;
  return (
    op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.EqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function hardcodedText(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${relative(SRC, file)}:${line + 1}  ${text.trim().replace(/\s+/g, " ")}`);
  };

  /** Strings inside a `{…}` that is shown: every literal that is not an argument or a comparison. */
  const visitShown = (node: ts.Node) => {
    // What a call returns is the callee's business (`t("key")`, `format(x)`).
    if (ts.isCallExpression(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isComparison(node) && isReadable(node.text)) report(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((s) => s.literal.text).join(" ");
      if (isReadable(text)) report(node, node.getText());
      return;
    }
    // In `a === "x" ? "Shown" : "Other"` only the two outcomes are shown.
    if (ts.isConditionalExpression(node)) {
      visitShown(node.whenTrue);
      visitShown(node.whenFalse);
      return;
    }
    ts.forEachChild(node, visitShown);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (isReadable(node.text)) report(node, node.text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const value = node.initializer;
      if (TEXT_ATTRIBUTES.has(name) && value) {
        if (ts.isStringLiteral(value)) {
          if (isReadable(value.text)) report(value, `${name}="${value.text}"`);
        } else if (ts.isJsxExpression(value) && value.expression) {
          visitShown(value.expression);
        }
      }
      // Other attributes (className, data-testid, …) hold no text; their
      // elements, if any, are still walked below.
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      visitShown(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the app's text", () => {
  it("comes from the locale files, not the markup", () => {
    const found = sourceFiles(SRC).flatMap(hardcodedText);
    expect(found).toEqual([]);
  });

  it("has no empty English text", () => {
    const empty: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        if (value.trim() === "") empty.push(path);
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
      }
    };
    walk(en, "");
    expect(empty).toEqual([]);
  });
});
