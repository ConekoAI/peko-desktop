/**
 * `@mention` helpers for the group composer. A peko answers a human's
 * group post when it is mentioned as `@<name>` (ADR-072 D2, matched as a
 * whole word, case-insensitively, by the engine).
 */

/** The `@word` being typed at `caret`, if any: where it starts and what follows the `@`. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[^\w@-])@([\w-]*)$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { start, query: match[2] };
}

/** Names that start with `query` (case-insensitive), in their given order. */
export function mentionCandidates(names: string[], query: string): string[] {
  const q = query.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(q));
}

/** Replace the `@word` at `start..caret` with `@name ` and return the text and new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  const after = text.slice(caret).replace(/^\S*/, "").replace(/^ /, "");
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length };
}
