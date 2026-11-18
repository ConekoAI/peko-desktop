/**
 * Usage counts (pekohub ADR-014): what happened, never what was said.
 *
 * Every event the app may send is in `UsageEvents`, with the only values
 * each property may take. The native side holds the same list and refuses
 * anything else (`src-tauri/src/usage.rs`); it also decides whether an
 * event leaves at all (the owner's switch, and a build with a key).
 * Adding an event amends the ADR and both lists.
 */
import { invoke } from "@tauri-apps/api/core";

export interface UsageEvents {
  app_opened: Record<string, never>;
  onboarding_step: { step: "model" | "peko" | "hello" | "done" | "skipped" };
  model_key_added: { api_format: "openai" | "anthropic" | "responses" | "other" };
  peko_created: { from: "blank" | "seed" };
  first_reply_received: { since_install: SinceInstall };
  message_sent: { kind: "dm" | "group"; has_attachment: boolean };
  group_created: Record<string, never>;
  approval_decided: { decision: "approve" | "deny" | "always" };
  settings_changed: { setting: "theme" | "language" | "keep_awake" | "crash_reports" | "usage_events" };
  update_installed: { from_version: string; to_version: string };
}

export type SinceInstall = "under_1m" | "under_5m" | "under_30m" | "under_1d" | "over_1d";

/** Count one thing that happened. Never throws, never waits. */
export function track<K extends keyof UsageEvents>(
  name: K,
  ...properties: UsageEvents[K] extends Record<string, never> ? [] : [UsageEvents[K]]
): void {
  try {
    void invoke("usage_event", { name, properties: properties[0] ?? {} }).catch(() => {});
  } catch {
    // No native side (a browser preview): nothing counts.
  }
}

const KNOWN_FORMATS = ["openai", "anthropic", "responses"] as const;

/** A model's wire format as the list allows it; anything unknown is "other". */
export function usageApiFormat(value: string | undefined): UsageEvents["model_key_added"]["api_format"] {
  return (KNOWN_FORMATS as readonly string[]).includes(value ?? "") ? (value as (typeof KNOWN_FORMATS)[number]) : "other";
}

/** How long after `installedAt` (ms) `now` is, as one of five ranges. */
export function sinceInstall(installedAt: number, now: number): SinceInstall {
  const minutes = (now - installedAt) / 60_000;
  if (minutes < 1) return "under_1m";
  if (minutes < 5) return "under_5m";
  if (minutes < 30) return "under_30m";
  if (minutes < 24 * 60) return "under_1d";
  return "over_1d";
}

const INSTALLED_AT = "peko.usage.installedAt";
const FIRST_REPLY = "peko.usage.firstReply";
const LAST_VERSION = "peko.usage.version";

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Once per start: count the open, remember when the app was first opened,
 * and count an update when the version is not the one seen last time.
 */
export function trackAppOpened(version: string, now = Date.now()): void {
  const kept = store();
  track("app_opened");
  if (!kept) return;
  if (!kept.getItem(INSTALLED_AT)) kept.setItem(INSTALLED_AT, String(now));
  const last = kept.getItem(LAST_VERSION);
  if (last && last !== version) track("update_installed", { from_version: last, to_version: version });
  kept.setItem(LAST_VERSION, version);
}

/** The first reply this install ever received; later ones count nothing. */
export function trackFirstReply(now = Date.now()): void {
  const kept = store();
  if (!kept || kept.getItem(FIRST_REPLY)) return;
  kept.setItem(FIRST_REPLY, "1");
  const stored = kept.getItem(INSTALLED_AT);
  const installedAt = stored !== null && Number.isFinite(Number(stored)) ? Number(stored) : now;
  track("first_reply_received", { since_install: sinceInstall(installedAt, now) });
}
