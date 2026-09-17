import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `@tauri-apps/api/core` so api.ts imports cleanly outside a
// Tauri runtime (same pattern as PrincipalCreateApi.test.ts).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Stub fetch before importing the module under test so the wrapper
// never touches the network.
let fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined;

vi.stubGlobal(
  "fetch",
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!fetchImpl) throw new Error("fetch stub not configured for this test");
    return fetchImpl(input, init);
  }),
);

import { pekohubListAccessiblePekos } from "../lib/api";

/**
 * Pekohub ADR-005: `/v1/me/accessible-pekos` replaced
 * `/v1/me/accessible-principals` (now 404). The wire envelope is
 * `{ pekos: [{ id, ownerName, pekoName, publicName, status }] }`;
 * the desktop maps `pekoName` into the internal `principalName`
 * machine identifier at the boundary.
 */
describe("pekohubListAccessiblePekos", () => {
  beforeEach(() => {
    fetchImpl = undefined;
  });

  it("GETs /v1/me/accessible-pekos with the bearer token", async () => {
    let lastUrl = "";
    let lastInit: RequestInit | undefined;
    fetchImpl = async (input, init) => {
      lastUrl = String(input);
      lastInit = init;
      return new Response(JSON.stringify({ pekos: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await pekohubListAccessiblePekos("https://pekohub.org", "tok_123");
    expect(lastUrl).toBe("https://pekohub.org/v1/me/accessible-pekos");
    expect((lastInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_123",
    );
  });

  it("maps the pekos envelope into AccessiblePrincipal rows (pekoName → principalName)", async () => {
    fetchImpl = async () =>
      new Response(
        JSON.stringify({
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
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const rows = await pekohubListAccessiblePekos("https://pekohub.org", "tok_123");
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
    fetchImpl = async () =>
      new Response(
        JSON.stringify([
          { id: "inst_2", ownerName: "bob", pekoName: "helper", publicName: "Helper", status: "offline" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const rows = await pekohubListAccessiblePekos("https://pekohub.org", "tok_123");
    expect(rows).toHaveLength(1);
    expect(rows[0].principalName).toBe("helper");
  });

  it("throws on a non-OK response with the status in the message", async () => {
    fetchImpl = async () => new Response("nope", { status: 401 });
    await expect(
      pekohubListAccessiblePekos("https://pekohub.org", "tok_123"),
    ).rejects.toThrow(/401/);
  });

  it("throws on an unexpected response shape", async () => {
    fetchImpl = async () =>
      new Response(JSON.stringify({ principals: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      pekohubListAccessiblePekos("https://pekohub.org", "tok_123"),
    ).rejects.toThrow(/Unexpected response format/);
  });
});
