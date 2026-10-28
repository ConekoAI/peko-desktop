/**
 * How a peko looks in the app: its name, its avatar (an emoji or short
 * monogram the owner chose, `identity.avatar` in the runtime) or its
 * initials, and an accent hue picked from its id so it stays the same
 * through renames.
 */

export const PEKO_ACCENTS = [
  "emerald",
  "sky",
  "violet",
  "amber",
  "rose",
  "teal",
  "indigo",
  "orange",
] as const;

export type PekoAccent = (typeof PEKO_ACCENTS)[number];

export interface PekoIdentity {
  name: string;
  /** The chosen emoji or monogram, if any. */
  avatar: string | null;
  /** Up to two letters from the name, for pekos without an avatar. */
  initials: string;
  accent: PekoAccent;
}

/** FNV-1a: a small stable hash, so the same id always gets the same hue. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pekoAccent(key: string): PekoAccent {
  return PEKO_ACCENTS[hash(key) % PEKO_ACCENTS.length];
}

/** "research-bot" → "RB", "alice" → "A", "" → "?". */
export function pekoInitials(name: string): string {
  const words = name.split(/[\s_\-.]+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 1);
  return letters.toUpperCase() || "?";
}

export function pekoIdentity(peko: {
  name: string;
  localId?: string;
  avatar?: string | null;
}): PekoIdentity {
  return {
    name: peko.name,
    avatar: peko.avatar?.trim() || null,
    initials: pekoInitials(peko.name),
    // The local id survives renames; older runtimes don't send it.
    accent: pekoAccent(peko.localId || peko.name),
  };
}

/** CSS colours for an accent, switching with the theme. */
export function accentStyle(accent: PekoAccent): { backgroundColor: string; color: string } {
  return {
    backgroundColor: `var(--peko-${accent}-soft)`,
    color: `var(--peko-${accent}-fg)`,
  };
}

/** Emoji / monogram suggestions for the avatar picker. */
export const AVATAR_SUGGESTIONS = [
  "🦊", "🐱", "🐼", "🦉", "🐙", "🐝", "🦄", "🐢",
  "🤖", "🧠", "🌱", "🔭", "📚", "🛠️", "🎨", "⚡",
];
