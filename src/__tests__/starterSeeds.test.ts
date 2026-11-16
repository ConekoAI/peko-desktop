// The starter seeds are read from the hub the app is set to use, through
// the backend, without a token.

import { describe, it, expect, vi, beforeEach } from "vitest";

const hubGetMock = vi.fn();
const hubSeedMock = vi.fn();
const settingsMock = vi.fn();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    hubApiBase: actual.hubApiBase,
    hubJson: actual.hubJson,
    hubGet: (...args: unknown[]) => hubGetMock(...args),
    hubSeed: (...args: unknown[]) => hubSeedMock(...args),
    settingsList: () => settingsMock(),
  };
});

import { listStarterSeeds, starterSeedText } from "../lib/starterSeeds";

beforeEach(() => {
  hubGetMock.mockReset();
  hubSeedMock.mockReset();
  settingsMock.mockReset();
  settingsMock.mockResolvedValue([]);
});

describe("starter seeds", () => {
  it("lists the official seeds from the default hub, and only those", async () => {
    hubGetMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { owner: "peko", name: "briefing", displayName: "Briefing", avatar: "📰", description: "Daily." },
            { owner: "peko", name: "coach", displayName: null, avatar: null, description: null },
            { owner: "mallory", name: "briefing", displayName: "Briefing" },
          ],
        }),
      ),
    );
    expect(await listStarterSeeds()).toEqual([
      { name: "briefing", displayName: "Briefing", avatar: "📰", description: "Daily." },
      { name: "coach", displayName: "coach", avatar: null, description: null },
    ]);
    expect(hubGetMock).toHaveBeenCalledWith("https://api.pekohub.ai", "seeds", {
      query: { owner: "peko", perPage: "12" },
    });
  });

  it("uses the hub the app is set to", async () => {
    settingsMock.mockResolvedValue([{ key: "pekohub.base_url", value: "http://localhost:3901" }]);
    hubSeedMock.mockResolvedValue(new Response('name = "coach"\n'));
    expect(await starterSeedText("coach")).toBe('name = "coach"\n');
    expect(hubSeedMock).toHaveBeenCalledWith("http://localhost:3901", "peko", "coach");
  });

  it("rejects when the hub refuses or isn't a hub", async () => {
    hubGetMock.mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(listStarterSeeds()).rejects.toThrow();
    hubGetMock.mockResolvedValue(new Response("<html>"));
    await expect(listStarterSeeds()).rejects.toThrow();
    hubSeedMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(starterSeedText("gone")).rejects.toThrow();
  });
});
