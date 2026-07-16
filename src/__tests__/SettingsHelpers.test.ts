import { describe, it, expect } from "vitest";
import { LOG_LEVELS, resolveLogLevel } from "../lib/settings-helpers";

/**
 * Regression tests for peko-desktop#5 — covers the Settings.tsx helpers.
 *
 * `LOG_LEVELS` / `resolveLogLevel` are no longer consumed by Settings.tsx
 * (T-107 removed the Daemon tab) but the helpers remain exported for any
 * future surface and the tests pin their behavior so a silent rename
 * doesn't break callers we haven't seen yet.
 */

describe("resolveLogLevel", () => {
  it("returns the configured level when present", () => {
    expect(
      resolveLogLevel([{ key: "daemon.log_level", value: "debug" }]),
    ).toBe("debug");
    expect(
      resolveLogLevel([{ key: "daemon.log_level", value: "warn" }]),
    ).toBe("warn");
  });

  it("defaults to 'info' when the setting is absent", () => {
    expect(resolveLogLevel([])).toBe("info");
    expect(resolveLogLevel(undefined)).toBe("info");
  });

  it("defaults to 'info' when the configured value is not a known level", () => {
    // Defensive: the backend could write a typo. The UI should not render
    // a non-existent log level as "active".
    expect(resolveLogLevel([{ key: "daemon.log_level", value: "verbose" }])).toBe(
      "info",
    );
  });

  it("LOG_LEVELS exposes the five expected levels in order", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error"]);
  });
});
