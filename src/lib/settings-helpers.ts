// Pure helpers extracted from src/pages/Settings.tsx so they can be
// imported by the Settings screen, the FirstRunWalkthrough overlay,
// and the SettingsHelpers unit test.
//
// `resolveProviderItems` powers the FirstRunWalkthrough's provider
// picker (a fresh user has no catalog yet, so the helper falls back
// to a canonical list so the picker isn't empty). The Settings →
// Credentials tab does NOT use it — that tab iterates the runtime's
// catalog directly so it can show "Configured first, rest of catalog
// below, orphans separately" (T-109b redesign).

export const FALLBACK_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "kimi",
  "ollama",
  "azure",
  "google",
] as const;

export interface ProviderItem {
  id: string;
  displayName: string;
}

/**
 * Resolve the walkthrough's provider list.
 * - When the runtime returns providers, use them (with their `displayName`).
 * - While loading and nothing has returned yet, render nothing (avoid flicker).
 * - When loading finished with an empty list, fall back to the canonical list
 *   so the picker is never empty for a brand-new user.
 */
export function resolveProviderItems(
  providers: ReadonlyArray<{ id: string; displayName?: string }> | undefined,
  isLoading: boolean,
): ProviderItem[] {
  if (providers && providers.length > 0) {
    return providers.map((p) => ({
      id: p.id,
      displayName: p.displayName || p.id,
    }));
  }
  if (isLoading) return [];
  return FALLBACK_PROVIDER_IDS.map((id) => ({ id, displayName: id }));
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
] as const;

/**
 * Pick the current log level from a flat settings list, defaulting to "info"
 * if the key isn't set yet.
 */
export function resolveLogLevel(
  settings: ReadonlyArray<{ key: string; value: string }> | undefined,
): LogLevel {
  const raw = settings?.find((s) => s.key === "daemon.log_level")?.value;
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as LogLevel)
    : "info";
}