import { describe, it, expect, vi, beforeEach } from "vitest";

// Hub calls go through the backend (`hub_get` / `hub_oauth_token`):
// the webview's content security policy allows no outside hosts. The
// mocked `invoke` answers as the backend does, with the hub's status
// and body.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  oauthTokenExchange,
  pekohubListAccessiblePekos,
  pekohubListRuntimes,
} from "../lib/api";
import { discoverySearch } from "../lib/discovery";

const answer = (status: number, body: unknown) => ({
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
});

/**
 * Pekohub ADR-005: `/v1/me/accessible-pekos` replaced
 * `/v1/me/accessible-principals` (now 404). The wire envelope is
 * `{ pekos: [{ id, ownerName, pekoName, publicName, status }] }`;
 * the desktop maps `pekoName` into the internal `principalName`
 * machine identifier at the boundary.
 */
describe("pekohubListAccessiblePekos", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("asks the backend for the accessible pekos with the bearer token", async () => {
    invokeMock.mockResolvedValue(answer(200, { pekos: [] }));
    await pekohubListAccessiblePekos("https://pekohub.ai", "tok_123");
    expect(invokeMock).toHaveBeenCalledWith("hub_get", {
      baseUrl: "https://pekohub.ai",
      resource: "accessible_pekos",
      accessToken: "tok_123",
      query: null,
    });
  });

  it("maps the pekos envelope into AccessiblePrincipal rows (pekoName → principalName)", async () => {
    invokeMock.mockResolvedValue(
      answer(200, {
        pekos: [
          {
            id: "inst_1",
            ownerName: "alice",
            pekoName: "coding-assistant",
            publicName: "Coding Assistant",
            status: "online",
          },
        ],
      }),
    );
    const rows = await pekohubListAccessiblePekos("https://pekohub.ai", "tok_123");
    expect(rows).toEqual([
      {
        id: "inst_1",
        ownerName: "alice",
        principalName: "coding-assistant",
        publicName: "Coding Assistant",
        status: "online",
      },
    ]);
  });

  it("tolerates a bare-array response", async () => {
    invokeMock.mockResolvedValue(
      answer(200, [
        { id: "inst_2", ownerName: "bob", pekoName: "helper", publicName: "Helper", status: "offline" },
      ]),
    );
    const rows = await pekohubListAccessiblePekos("https://pekohub.ai", "tok_123");
    expect(rows).toHaveLength(1);
    expect(rows[0].principalName).toBe("helper");
  });

  it("throws on a non-OK response with the status in the message", async () => {
    invokeMock.mockResolvedValue(answer(401, "nope"));
    await expect(pekohubListAccessiblePekos("https://pekohub.ai", "tok_123")).rejects.toThrow(
      /401/,
    );
  });

  it("throws on an unexpected response shape", async () => {
    invokeMock.mockResolvedValue(answer(200, { principals: [] }));
    await expect(pekohubListAccessiblePekos("https://pekohub.ai", "tok_123")).rejects.toThrow(
      /Unexpected response format/,
    );
  });

  it("says so when the address serves a web page, not a hub API", async () => {
    invokeMock.mockResolvedValue(answer(200, "<!DOCTYPE html><html></html>"));
    await expect(pekohubListAccessiblePekos("https://pekohub.ai", "tok_123")).rejects.toThrow(
      "pekohub.ai didn't answer as a PekoHub: no hub API at this address",
    );
  });

  it("turns a hub it couldn't reach into an Error", async () => {
    invokeMock.mockImplementation(() =>
      Promise.reject("Couldn't reach pekohub.ai: connection refused"),
    );
    const error = await pekohubListAccessiblePekos("https://pekohub.ai", "tok_123").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Couldn't reach pekohub.ai: connection refused");
  });
});

describe("the other hub calls go through the backend too", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("exchanges an OAuth code at the token endpoint", async () => {
    invokeMock.mockResolvedValue(answer(200, { access_token: "at", refresh_token: "rt" }));
    const tokens = await oauthTokenExchange({
      baseUrl: "https://pekohub.ai",
      clientId: "peko-desktop",
      code: "c0de",
      redirectUri: "http://127.0.0.1:53682/callback",
      codeVerifier: "v3rifier",
    });
    expect(tokens.access_token).toBe("at");
    expect(invokeMock).toHaveBeenCalledWith("hub_oauth_token", {
      baseUrl: "https://pekohub.ai",
      params: {
        grant_type: "authorization_code",
        client_id: "peko-desktop",
        code: "c0de",
        redirect_uri: "http://127.0.0.1:53682/callback",
        code_verifier: "v3rifier",
      },
    });
  });

  it("lists the account's runtimes", async () => {
    invokeMock.mockResolvedValue(answer(200, { runtimes: [{ id: "rt_1", name: "Laptop" }] }));
    const runtimes = await pekohubListRuntimes("https://pekohub.ai", "tok_123");
    expect(runtimes).toEqual([{ id: "rt_1", name: "Laptop", url: undefined }]);
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ resource: "runtimes", accessToken: "tok_123" });
  });

  it("searches the directory with its query", async () => {
    invokeMock.mockResolvedValue(answer(200, { hits: [], total: 0, page: 1 }));
    await discoverySearch("https://pekohub.ai", { q: "fox", category: "coding" });
    expect(invokeMock).toHaveBeenCalledWith("hub_get", {
      baseUrl: "https://pekohub.ai",
      resource: "discovery_search",
      accessToken: null,
      query: [
        ["q", "fox"],
        ["category", "coding"],
        ["page", "1"],
        ["per_page", "24"],
      ],
    });
  });
});
