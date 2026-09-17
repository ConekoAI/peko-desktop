// Wire-shape pins for the ADR-056 `.peko` package wrappers. The Rust
// commands are `principal_import(file_path, name, runtime_id)` and
// `principal_export(name, output, runtime_id)`; Tauri camelCases the
// arg names on the wire. Same mock pattern as PrincipalCreateApi.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { principalExport, principalImport } from "../lib/api";

const mockedInvoke = vi.mocked(invoke);

describe("principal package wire shape (ADR-056)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({});
  });

  it("principalImport maps `path` to the Rust `filePath` arg", async () => {
    await principalImport({ path: "~/.peko/alice.peko" });
    expect(mockedInvoke).toHaveBeenCalledWith("principal_import", {
      filePath: "~/.peko/alice.peko",
      name: null,
      runtimeId: null,
    });
  });

  it("principalExport sends name + output", async () => {
    await principalExport({
      name: "alice",
      output: "~/.peko/exports/alice.peko",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("principal_export", {
      name: "alice",
      output: "~/.peko/exports/alice.peko",
    });
  });

  it("principalImport propagates the runtime's keyless-package rejection verbatim", async () => {
    mockedInvoke.mockRejectedValueOnce(
      "package has no keys — ground it with `peko create`",
    );
    await expect(
      principalImport({ path: "~/.peko/keyless.peko" }),
    ).rejects.toBe("package has no keys — ground it with `peko create`");
  });
});
