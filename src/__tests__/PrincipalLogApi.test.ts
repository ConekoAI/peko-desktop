// `principal_log` pages arrive with snake_case paging fields; the chat
// reads `nextCursor` / `hasMore`. Without the mapping, "Load earlier
// messages" never appeared.

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { principalLog } from "../lib/api";

const mockedInvoke = vi.mocked(invoke);

describe("principalLog", () => {
  it("maps the engine's next_cursor / has_more onto the page", async () => {
    mockedInvoke.mockResolvedValue({
      type: "principal_log",
      name: "nova",
      peer: { kind: "user", id: "local" },
      messages: [
        { schemaVersion: 1, id: "m1", sender: { kind: "user", id: "local" }, timestamp: "t", text: "hi" },
      ],
      next_cursor: "c-older",
      has_more: true,
    });
    const page = await principalLog({ name: "nova", peer: "user:local", limit: 100 });
    expect(page.nextCursor).toBe("c-older");
    expect(page.hasMore).toBe(true);
    expect(page.peer).toBe("user:local");
    expect(page.messages[0].sender).toBe("user:local");
  });

  it("reads the last page as having no cursor", async () => {
    mockedInvoke.mockResolvedValue({
      name: "nova",
      peer: "user:local",
      messages: [],
      next_cursor: null,
      has_more: false,
    });
    const page = await principalLog({ name: "nova" });
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });
});
