/**
 * Typed error surface for the channel IPC wrappers.
 *
 * Channel reads (`channel_list` / `channel_get` / `channel_events` /
 * `channel_members`) and posts are membership-gated runtime-side
 * (peko-runtime ADR-058): a principal that is not a member of the
 * channel gets a `[forbidden]` refusal instead of data. Tauri
 * surfaces those refusals as plain rejected strings, which the UI
 * could only render as a generic failure. This module classifies the
 * raw rejection into a `ChannelError` so membership gates are a
 * distinct, renderable state ("you don't have access to this
 * channel") rather than an opaque error.
 *
 * The classifier lives in its own module (not `api.ts`) so hook unit
 * tests that stub `../lib/api` don't have to re-export it.
 */

export type ChannelErrorKind = "forbidden" | "unknown";

export class ChannelError extends Error {
  readonly kind: ChannelErrorKind;

  constructor(kind: ChannelErrorKind, message: string) {
    super(message);
    this.name = "ChannelError";
    this.kind = kind;
  }

  /** True when the runtime's membership gate rejected the call. */
  get forbidden(): boolean {
    return this.kind === "forbidden";
  }
}

/**
 * Message shapes the runtime / hub uses for membership refusals:
 * - `[forbidden] ...` — the runtime's tagged refusal prefix
 *   (ADR-058; e.g. a `user:<id>` sender_name or a non-member peek).
 * - "not a member" / "membership" — membership-gate phrasing.
 * - "permission denied" / "forbidden" — hub-side 403 phrasing.
 */
const FORBIDDEN_RE =
  /\[forbidden\]|not a member|membership|permission denied|forbidden/i;

/**
 * Convert a raw IPC rejection (string, Error, or unknown) into a
 * `ChannelError`, preserving the original message verbatim.
 */
export function classifyChannelError(raw: unknown): ChannelError {
  const message = raw instanceof Error ? raw.message : String(raw);
  return new ChannelError(
    FORBIDDEN_RE.test(message) ? "forbidden" : "unknown",
    message,
  );
}

/** Type guard for the membership-gated case. */
export function isChannelForbidden(err: unknown): err is ChannelError {
  return err instanceof ChannelError && err.kind === "forbidden";
}

/**
 * Rethrow helper for query/mutation functions:
 * `channelList(...).catch(rethrowAsChannelError)`.
 */
export function rethrowAsChannelError(raw: unknown): never {
  throw classifyChannelError(raw);
}
