// Pure helpers extracted from src/pages/Settings.tsx so they can be
// imported by the Settings screen, the FirstRunWalkthrough overlay,
// and the SettingsHelpers unit test.

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
