import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrincipalSummary } from "../lib/api";

// Mock `@tauri-apps/api/core` so the desktop api.ts module can be
// imported without a Tauri runtime. This is the first test in the
// suite to mock `invoke` directly; prior tests pinned only pure
// data shapes (EngineTypes) or React Query state hooks in isolation
// (EngineHelpers). The pattern here is reusable for any future
// `src/lib/api.ts` wrapper test.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { principalCreate } from "../lib/api";

const mockedInvoke = vi.mocked(invoke);

const STUB_SUMMARY: PrincipalSummary = {
  name: "alice",
  exposure: "Private",
  status: "online",
  description: "personal assistant",
  owner: "user:desktop",
  runtimeId: "local",
};

describe("principalCreate wire shape", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(STUB_SUMMARY);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls invoke with the principal_create command name", async () => {
    await principalCreate({ name: "alice" });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    const [command] = mockedInvoke.mock.calls[0] as [string, unknown];
    expect(command).toBe("principal_create");
  });

  it("sends optional fields as null when omitted (the runtime uses #[serde(default)])", async () => {
    await principalCreate({ name: "alice" });
    const [, payload] = mockedInvoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toEqual({
      name: "alice",
      description: null,
      preferred_provider_id: null,
      preferred_model_id: null,
    });
  });

  it("passes optional fields through verbatim when set", async () => {
    await principalCreate({
      name: "alice",
      description: "personal assistant",
      preferredProviderId: "openai",
      preferredModelId: "gpt-4o",
    });
    const [, payload] = mockedInvoke.mock.calls[0] as [string, Record<string, unknown>];
    // snake_case keys match the runtime's serde rename; the
    // PreferredXyzId (camelCase) → preferred_Xyz_id (snake_case)
    // mapping is what `principalCreate()` in api.ts enforces.
    expect(payload).toEqual({
      name: "alice",
      description: "personal assistant",
      preferred_provider_id: "openai",
      preferred_model_id: "gpt-4o",
    });
  });

  it("returns the runtime's projected PrincipalSummary", async () => {
    const summary = await principalCreate({ name: "alice" });
    expect(summary).toEqual(STUB_SUMMARY);
    expect(summary.name).toBe("alice");
    expect(summary.runtimeId).toBe("local");
  });

  it("propagates a rejection from invoke (e.g. AlreadyExists)", async () => {
    mockedInvoke.mockRejectedValueOnce("principal alice already exists");
    await expect(principalCreate({ name: "alice" })).rejects.toBe(
      "principal alice already exists",
    );
  });
});