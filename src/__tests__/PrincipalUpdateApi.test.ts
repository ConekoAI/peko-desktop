// The Rust `principal_update` command takes one struct argument named
// `req`; Tauri rejects flat keys ("missing required key req"). Pin the
// nesting so the profile editor's Save keeps reaching the runtime.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { principalUpdate } from "../lib/api";

const mockedInvoke = vi.mocked(invoke);

describe("principalUpdate wire shape", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({});
  });

  it("nests the fields under `req`, avatar included", async () => {
    await principalUpdate({ name: "alice", description: "helper", avatar: "🦊" });
    expect(mockedInvoke).toHaveBeenCalledWith("principal_update", {
      req: {
        name: "alice",
        description: "helper",
        status: null,
        exposure: null,
        preferredModelId: null,
        avatar: "🦊",
        runtimeId: null,
      },
    });
  });
});
