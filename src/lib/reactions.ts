/**
 * Reactions and replies (runtime ADR-126).
 *
 * A reaction is a post carrying `react: { to, emoji, remove? }`. It is
 * never a message: it is not drawn as one, and the reactions on a
 * message are the fold of every such post, as the runtime folds them
 * (`peko_channel::reactions`): per (author, emoji, message) the latest
 * op by `at`, ties by `msg_id`, wins; at most 20 different emoji stand
 * on one message; a reaction to a reaction is ignored.
 *
 * A reply carries `reply_to`, the `msg_id` of the message it answers.
 * Clients quote that message above the reply, except when the reply
 * directly follows it (D6).
 */

/** One emoji on a message, with who put it there (oldest first). */
export interface Reaction {
  emoji: string;
  by: string[];
}

/** What a reaction post carries. */
export interface ReactOp {
  to: string;
  emoji: string;
  remove?: boolean;
}

/** The few emoji offered first; any single emoji may be typed. */
export const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏"] as const;

/** Most different emoji that stand on one message. */
export const MAX_EMOJI_PER_MESSAGE = 20;

interface PostLike {
  kind: string;
  author?: string;
  at?: string;
  msg_id?: string | null;
  react?: ReactOp | null;
}

/** Whether `event` is a message, not a reaction (D2). */
export function isMessage(event: PostLike): boolean {
  return event.kind === "posted" && !event.react;
}

/** The reactions on each message of `events`, by `msg_id`. */
export function foldReactions(events: PostLike[]): Map<string, Reaction[]> {
  const reactionIds = new Set<string>();
  const ops: { at: number; atText: string; id: string; author: string; op: ReactOp }[] = [];
  for (const e of events) {
    if (e.kind !== "posted" || !e.react || !e.author) continue;
    if (e.msg_id) reactionIds.add(e.msg_id);
    const at = Date.parse(e.at ?? "");
    ops.push({ at: Number.isNaN(at) ? 0 : at, atText: e.at ?? "", id: e.msg_id ?? "", author: e.author, op: e.react });
  }
  ops.sort((a, b) => a.at - b.at || a.atText.localeCompare(b.atText) || a.id.localeCompare(b.id));
  const on = new Map<string, Reaction[]>();
  for (const { author, op } of ops) {
    if (reactionIds.has(op.to) || !op.emoji) continue;
    const list = on.get(op.to) ?? [];
    const i = list.findIndex((r) => r.emoji === op.emoji);
    if (op.remove) {
      if (i >= 0) {
        list[i] = { ...list[i], by: list[i].by.filter((a) => a !== author) };
        if (list[i].by.length === 0) list.splice(i, 1);
      }
    } else if (i >= 0) {
      if (!list[i].by.includes(author)) list[i] = { ...list[i], by: [...list[i].by, author] };
    } else if (list.length < MAX_EMOJI_PER_MESSAGE) {
      list.push({ emoji: op.emoji, by: [author] });
    }
    on.set(op.to, list);
  }
  return on;
}

/**
 * Whether a reply's quote is shown (D6): not when the reply directly
 * follows the message it answers — `previousMsgId` is the message drawn
 * just before it.
 */
export function showsQuote(replyTo: string | null | undefined, previousMsgId: string | null | undefined): boolean {
  return !!replyTo && replyTo !== previousMsgId;
}

/** The start of a message as a quote shows it: one line, `max` characters. */
export function quoteText(text: string, max = 140): string {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Whether `emoji` reads as one emoji, as the runtime accepts it. */
export function looksLikeEmoji(emoji: string): boolean {
  const s = emoji.trim();
  if (!s || new TextEncoder().encode(s).length > 64) return false;
  if (/[A-Za-z0-9\s]/.test(s.replace(/[0-9#*]️?⃣/u, ""))) return false;
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<unknown> } }).Segmenter;
  if (Segmenter) {
    const parts = [...new Segmenter(undefined, { granularity: "grapheme" }).segment(s)];
    if (parts.length !== 1) return false;
  }
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s);
}
