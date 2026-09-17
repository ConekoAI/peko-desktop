import { describe, it, expect } from "vitest";
import { shareUrlFor, deepLinkFor } from "../lib/discovery";

/**
 * PR #8: pure-function tests for the discovery URL builders.
 * These are the contract the OS hands the desktop when the user
 * clicks an "Add to my desktop" button on a hub discover card —
 * if the shape drifts, the deep-link round-trip silently breaks.
 *
 * Pekohub ADR-005: emission is `/peko/{owner}/{name}` wrapped in
 * `peko://add-peko`; the legacy `/p/` + `peko://add-principal`
 * forms are accepted on receipt (see DeepLink.test.ts) but never
 * emitted.
 */
describe("shareUrlFor", () => {
  it("encodes owner and principal name into the canonical share path", () => {
    expect(shareUrlFor("https://pekohub.org", { ownerName: "alice", publicName: "coding-assistant" }))
      .toBe("https://pekohub.org/peko/alice/coding-assistant");
  });

  it("URL-encodes owner / principal names with special characters", () => {
    expect(shareUrlFor("https://pekohub.org", { ownerName: "alice/bob", publicName: "my agent" }))
      .toBe("https://pekohub.org/peko/alice%2Fbob/my%20agent");
  });

  it("strips a trailing slash from the hub URL", () => {
    expect(shareUrlFor("https://hub.example.com/", { ownerName: "alice", publicName: "p" }))
      .toBe("https://hub.example.com/peko/alice/p");
  });

  it("accepts plain http URLs", () => {
    expect(shareUrlFor("http://localhost:8080", { ownerName: "alice", publicName: "p" }))
      .toBe("http://localhost:8080/peko/alice/p");
  });
});

describe("deepLinkFor", () => {
  it("wraps shareUrlFor in the peko://add-peko deep-link", () => {
    expect(deepLinkFor("https://pekohub.org", { ownerName: "alice", publicName: "p" }))
      .toBe("peko://add-peko?url=https%3A%2F%2Fpekohub.org%2Fpeko%2Falice%2Fp");
  });

  it("double-encodes the share URL so PR #6's parseDeepLink can decode it back", () => {
    // The share URL contains an inner `?token=abc` — its ampersand
    // would otherwise be parsed as a top-level deep-link query
    // separator. Double-encoding keeps the share URL atomic.
    const result = deepLinkFor("https://hub.example.com", {
      ownerName: "alice",
      publicName: "p",
    });
    // Single encoding only — the inner share URL itself has no
    // additional separators in the canonical form.
    expect(result.startsWith("peko://add-peko?url=")).toBe(true);
    // The round-trip parses cleanly via PR #6's parseDeepLink:
    expect(decodeURIComponent(result.split("?url=")[1])).toBe(
      "https://hub.example.com/peko/alice/p",
    );
  });
});
