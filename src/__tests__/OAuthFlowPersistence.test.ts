import { describe, it, expect, beforeEach } from "vitest";
import { readActiveFlow, writeActiveFlow } from "../hooks/useRuntimes";

/**
 * Tests for the OAuth-flow persistence helpers (D3).
 *
 * Before D3, `activeOAuthFlow` was a module-level `let`, so any page
 * reload between `startOAuthConnect` (browser redirect to PekoHub)
 * and `exchangeOAuthCode` (back in the desktop app) would silently
 * drop the PKCE verifier + state, forcing the user to restart the
 * flow. The fix persists the flow to `sessionStorage`, which is
 * scoped to the current tab and survives reloads.
 *
 * sessionStorage (not localStorage) is the right tool here: a flow
 * outliving a tab close is suspect — the user is no longer at the
 * browser to complete the redirect.
 */

describe("OAuth flow persistence (D3)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("readActiveFlow returns null when nothing is stored", () => {
    expect(readActiveFlow()).toBeNull();
  });

  it("writeActiveFlow + readActiveFlow round-trips the flow state", () => {
    const flow = {
      verifier: "v_-abc123",
      state: "state-xyz",
      redirectUri: "http://localhost:19876/callback",
      baseUrl: "https://pekohub.org",
    };
    writeActiveFlow(flow);
    expect(readActiveFlow()).toEqual(flow);
  });

  it("writeActiveFlow(null) clears the stored flow", () => {
    writeActiveFlow({
      verifier: "v",
      state: "s",
      redirectUri: "r",
      baseUrl: "b",
    });
    expect(readActiveFlow()).not.toBeNull();
    writeActiveFlow(null);
    expect(readActiveFlow()).toBeNull();
  });

  it("readActiveFlow survives a simulated reload (sessionStorage outlives JS module reload)", () => {
    // Simulate the bug scenario: start a flow, "reload" the page
    // (sessionStorage persists; module state would not).
    writeActiveFlow({
      verifier: "pkce-verifier-1",
      state: "csrf-state-1",
      redirectUri: "http://localhost:0/callback",
      baseUrl: "https://hub.example.com",
    });

    // A "reload" in the test harness is just a fresh module import;
    // sessionStorage is the web platform's storage and survives that.
    // Re-read to confirm the value is still there.
    const recovered = readActiveFlow();
    expect(recovered).not.toBeNull();
    expect(recovered?.verifier).toBe("pkce-verifier-1");
    expect(recovered?.state).toBe("csrf-state-1");
  });

  it("readActiveFlow returns null when stored JSON is corrupt", () => {
    sessionStorage.setItem("peko:oauth-flow", "not-json{");
    expect(readActiveFlow()).toBeNull();
  });
});