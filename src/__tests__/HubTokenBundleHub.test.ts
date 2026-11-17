import { describe, it, expect, vi, beforeEach } from "vitest";

// The stored sign-in records the hub that issued it; the backend sends its
// tokens to that hub only (a share link may name another hub).
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { exchangeOAuthCode, refreshStoredToken, writeActiveFlow } from "../hooks/useRuntimes";

const answer = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });

describe("the stored sign-in belongs to its hub", () => {
  let stored: string | null;

  beforeEach(() => {
    sessionStorage.clear();
    stored = null;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      switch (cmd) {
        case "hub_oauth_token":
          return answer(200, { access_token: "a2", refresh_token: "r2", expires_in: 3600 });
        case "credential_set_raw":
          stored = args.rawValue as string;
          return undefined;
        case "credential_get_raw":
          return stored;
        case "runtime_hub_register":
          return { account: "acct" };
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    });
  });

  it("records the hub a sign-in came from", async () => {
    writeActiveFlow({
      verifier: "v",
      state: "s",
      redirectUri: "http://localhost:0/callback",
      baseUrl: "https://pekohub.ai/",
    });
    await exchangeOAuthCode("code", "s");
    expect(JSON.parse(stored!).hub).toBe("https://api.pekohub.ai");
  });

  it("refreshes at the hub that issued the refresh token, whatever is asked", async () => {
    stored = JSON.stringify({ access_token: "a", refresh_token: "r", hub: "https://hub.example" });
    await refreshStoredToken("https://evil.example");
    const call = invokeMock.mock.calls.find(([cmd]) => cmd === "hub_oauth_token")!;
    expect(call[1].baseUrl).toBe("https://hub.example");
    expect(JSON.parse(stored!).hub).toBe("https://hub.example");
  });
});
