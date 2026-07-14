import { describe, it, expect } from "vitest";
import {
  FALLBACK_PROVIDER_IDS,
  LOG_LEVELS,
  resolveLogLevel,
  resolveProviderItems,
} from "../lib/settings-helpers";

/**
 * Regression tests for peko-desktop#5 — covers the Settings.tsx helpers.
 *
 * `resolveProviderItems` still powers the FirstRunWalkthrough's provider
 * picker (T-109b redesign). The redesigned Settings → Credentials tab
 * iterates the runtime's catalog directly so it can show "Configured
 * first, rest of catalog below, orphans separately" — but the
 * walkthrough still wants a non-empty picker on first launch, so the
 * helper + `FALLBACK_PROVIDER_IDS` stay exported.
 *
 * `LOG_LEVELS` / `resolveLogLevel` are no longer consumed by Settings.tsx
 * (T-107 removed the Daemon tab) but the helpers remain exported for any
 * future surface and the tests pin their behavior so a silent rename
 * doesn't break callers we haven't seen yet.
 */

describe("resolveProviderItems", () => {
  it("uses runtime-provided providers with their displayName", () => {
    const result = resolveProviderItems(
      [
        { id: "openai", displayName: "OpenAI" },
        { id: "anthropic", displayName: "Anthropic" },
      ],
      false,
    );
    expect(result).toEqual([
      { id: "openai", displayName: "OpenAI" },
      { id: "anthropic", displayName: "Anthropic" },
    ]);
  });

  it("falls back to id when displayName is missing", () => {
    const result = resolveProviderItems([{ id: "custom-llm" }], false);
    expect(result).toEqual([{ id: "custom-llm", displayName: "custom-llm" }]);
  });

  it("returns the canonical fallback list when the runtime returns no providers and we are no longer loading", () => {
    const result = resolveProviderItems([], false);
    expect(result.map((p) => p.id)).toEqual([...FALLBACK_PROVIDER_IDS]);
    // displayName should fall back to the id when not provided
    expect(result.every((p) => p.displayName === p.id)).toBe(true);
  });

  it("returns an empty list while loading and nothing has returned yet (avoids UI flicker)", () => {
    expect(resolveProviderItems(undefined, true)).toEqual([]);
  });

  it("prefers runtime providers over the fallback when both would apply", () => {
    const result = resolveProviderItems(
      [{ id: "openai", displayName: "OpenAI" }],
      false,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai");
    expect(result[0].displayName).toBe("OpenAI");
  });
});

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