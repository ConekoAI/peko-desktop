import { describe, it, expect } from "vitest";
import { configuredHubUrl, hubApiBase, DEFAULT_HUB_URL } from "../lib/api";

describe("hubApiBase", () => {
  it("maps the official website hosts to api.pekohub.ai", () => {
    for (const web of ["https://pekohub.ai", "https://pekohub.ai/peko/a/b", "https://pekohub.org/", "https://www.pekohub.ai"]) {
      expect(hubApiBase(web)).toBe("https://api.pekohub.ai");
    }
  });

  it("keeps other hubs at their origin, and defaults to the official API", () => {
    expect(hubApiBase("http://localhost:3000/somewhere")).toBe("http://localhost:3000");
    expect(hubApiBase("https://api.pekohub.ai/")).toBe("https://api.pekohub.ai");
    expect(hubApiBase("")).toBe(DEFAULT_HUB_URL);
    expect(hubApiBase(undefined)).toBe("https://api.pekohub.ai");
  });

  it("reads the configured hub from settings", () => {
    expect(configuredHubUrl([{ key: "pekohub.base_url", value: "https://pekohub.ai" }])).toBe("https://api.pekohub.ai");
    expect(configuredHubUrl([])).toBe("https://api.pekohub.ai");
  });
});
