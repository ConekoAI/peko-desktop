/**
 * Question cards (runtime ADR-114): a peko asks one or more questions
 * with a message, and the person answers them together. The answer is
 * the person's own message — its text reads the answers — so a card
 * carries no authority, unlike an approval request.
 */
import type { Answers, Ask, Pick } from "../types";

/**
 * The readable text of `answers`, one line per question:
 * `Which day? → Tue`, choices joined by ", ", the person's own words
 * after " — ". The same text the runtime writes (`render_answers`).
 */
export function renderAnswers(ask: Ask, answers: Answers): string {
  return ask.questions
    .map((q, i) => {
      const pick = answers.picks[i] ?? {};
      const chosen = (pick.chosen ?? []).join(", ");
      const other = pick.other?.trim();
      const answer = other ? (chosen ? `${chosen} — ${other}` : other) : chosen;
      return `${q.text} → ${answer}`;
    })
    .join("\n");
}

/** Whether every question has a choice or words. */
export function answersComplete(picks: Pick[], ask: Ask): boolean {
  return ask.questions.every((_, i) => {
    const pick = picks[i];
    return !!pick && ((pick.chosen?.length ?? 0) > 0 || !!pick.other?.trim());
  });
}

/** `picks` trimmed for sending: empty fields dropped. */
export function cleanPicks(picks: Pick[]): Pick[] {
  return picks.map((p) => {
    const out: Pick = {};
    if (p.chosen && p.chosen.length > 0) out.chosen = p.chosen;
    const other = p.other?.trim();
    if (other) out.other = other;
    return out;
  });
}

/** A message in a thread, as far as a card's state goes. */
export interface CardThreadItem {
  isUser: boolean;
  ask?: Ask;
  answers?: Answers;
  msgId?: string | null;
}

/** What a thread knows about one card. */
export interface CardState {
  /** Answerable now. */
  open: boolean;
  /** The answers that name it, if any. */
  answered?: Answers;
}

/**
 * A DM's cards (ADR-114 D3): a card stays open until an answer names it,
 * the peko asks a newer card, or the person writes anything after it
 * (their answer in their own words). The peko's other messages — a
 * check-in, a reminder — leave it open. Indexed like `items`; `undefined`
 * where an item asks nothing.
 */
export function dmCardStates(items: CardThreadItem[]): (CardState | undefined)[] {
  return items.map((item, i) => {
    if (!item.ask) return undefined;
    const later = items.slice(i + 1);
    const answered = item.msgId
      ? later.find((l) => l.answers?.to === item.msgId)?.answers
      : undefined;
    const open = !answered && !later.some((l) => l.isUser || (!l.isUser && l.ask));
    return { open, ...(answered && { answered }) };
  });
}

/** A group post, as far as a card's state goes. */
export interface GroupCardPost {
  author: string;
  msgId?: string;
  ask?: Ask;
  answers?: Answers;
}

/**
 * A group's cards (ADR-114 D3): open until an answer names it or the
 * same peko asks a newer card. Other members' posts leave it open.
 */
export function groupCardStates(posts: GroupCardPost[]): (CardState | undefined)[] {
  return posts.map((post, i) => {
    if (!post.ask) return undefined;
    const later = posts.slice(i + 1);
    const answered = post.msgId
      ? later.find((l) => l.answers?.to === post.msgId)?.answers
      : undefined;
    const replaced = later.some((l) => l.author === post.author && l.ask);
    return { open: !answered && !replaced, ...(answered && { answered }) };
  });
}
