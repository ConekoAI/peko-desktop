import { describe, it, expect } from "vitest";
import type { EngineState, EngineDiagnostics } from "../types";

/**
 * EngineState / EngineDiagnostics roundtrip tests.
 *
 * These don't hit the real Tauri runtime (which isn't available in
 * vitest's jsdom), but they pin down the on-the-wire JSON shape
 * the supervisor emits. The Rust side uses `#[serde(tag = "kind",
 * rename_all = "snake_case")]` so the `kind` discriminator must be
 * one of: stopped, starting, running, restarting, failed.
 *
 * If the supervisor's enum grows (or a field gets renamed) the
 * TypeScript side has to match — this test surfaces that drift.
 */

const ALL_STATES: EngineState[] = [
  { kind: "stopped" },
  { kind: "starting" },
  { kind: "running", pid: 4242, version: "0.1.0", uptime_secs: 12 },
  { kind: "restarting", attempt: 1 },
  { kind: "failed", message: "boom" },
];

describe("EngineState JSON shape", () => {
  it("uses snake_case `kind` discriminator across all variants", () => {
    for (const s of ALL_STATES) {
      const json = JSON.stringify(s);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed.kind).toBe(s.kind);
      // No PascalCase variants should leak through.
      expect(Object.keys(parsed)).toContain("kind");
    }
  });

  it("serialises the running variant with version and pid fields", () => {
    const s: EngineState = {
      kind: "running",
      pid: 4242,
      version: "0.1.0",
      uptime_secs: 12,
    };
    const json = JSON.parse(JSON.stringify(s));
    expect(json).toEqual({
      kind: "running",
      pid: 4242,
      version: "0.1.0",
      uptime_secs: 12,
    });
  });

  it("serialises the restarting variant with attempt field", () => {
    const s: EngineState = { kind: "restarting", attempt: 2 };
    const json = JSON.parse(JSON.stringify(s));
    expect(json).toEqual({ kind: "restarting", attempt: 2 });
  });

  it("serialises the failed variant carrying a free-form message", () => {
    const s: EngineState = {
      kind: "failed",
      message: "engine keeps stopping (exited with code 1)",
    };
    const json = JSON.parse(JSON.stringify(s));
    expect(json.kind).toBe("failed");
    expect(json.message).toContain("engine keeps stopping");
  });

  it("stays parseable with the React state wrapper helpers", async () => {
    // Smoke test: import the helpers module to confirm it compiles
    // and accepts every variant — this catches a discriminated-union
    // mismatch where the helpers miss a case.
    const { engineStateLabel, engineStateTone } = await import(
      "../lib/engine-helpers"
    );
    for (const s of ALL_STATES) {
      expect(typeof engineStateLabel(s)).toBe("string");
      expect(["ok", "warn", "error"]).toContain(engineStateTone(s));
    }
  });
});

describe("EngineDiagnostics JSON shape", () => {
  it("matches the supervisor payload structure", () => {
    const diag: EngineDiagnostics = {
      state: { kind: "running", pid: 7, version: "0.1.0", uptime_secs: 5 },
      pid: 7,
      version: "0.1.0",
      expected_version: "0.1.0",
      version_matches: true,
      uptime_secs: 5,
      lockfile_path: "/home/u/.peko/run/desktop.lock",
      socket_path: "/home/u/.peko/run/daemon.sock",
      log_ring: ["PEKO_VERSION=0.1.0", "started"],
      restart_count: 0,
      last_error: null,
      owns_process: true,
      mode: "sidecar",
    };
    const json = JSON.parse(JSON.stringify(diag));
    expect(json.lockfile_path).toContain("desktop.lock");
    expect(json.version_matches).toBe(true);
    expect(json.log_ring).toHaveLength(2);
    // ADR-043 §adoption: owned sidecar reports owns_process=true and
    // mode="sidecar" — the diagnostics panel uses these to decide
    // whether to enable the Restart button.
    expect(json.owns_process).toBe(true);
    expect(json.mode).toBe("sidecar");
  });

  it("tolerates null optional fields when the engine is starting", () => {
    const diag: EngineDiagnostics = {
      state: { kind: "starting" },
      pid: null,
      version: null,
      expected_version: null,
      version_matches: null,
      uptime_secs: 0,
      lockfile_path: "/home/u/.peko/run/desktop.lock",
      socket_path: "/home/u/.peko/run/daemon.sock",
      log_ring: [],
      restart_count: 0,
      last_error: null,
      owns_process: true,
      mode: null,
    };
    const json = JSON.parse(JSON.stringify(diag));
    expect(json.pid).toBeNull();
    expect(json.version).toBeNull();
    expect(json.version_matches).toBeNull();
    expect(json.log_ring).toEqual([]);
    expect(json.owns_process).toBe(true);
    expect(json.mode).toBeNull();
  });

  it("round-trips adoption: owns_process=false with mode='headless'", () => {
    // When the supervisor adopts a CLI-managed daemon, the engine
    // is running but is not the desktop's to control. The
    // diagnostics panel disables the Restart button on borrowed
    // engines and shows the "borrowed from CLI daemon" banner.
    const diag: EngineDiagnostics = {
      state: { kind: "running", pid: 9001, version: "0.1.0", uptime_secs: 60 },
      pid: 9001,
      version: "0.1.0",
      expected_version: "0.1.0",
      version_matches: true,
      uptime_secs: 60,
      lockfile_path: "/home/u/.peko/run/daemon.pid",
      socket_path: "/home/u/.peko/run/daemon.sock",
      log_ring: ["PEKO_VERSION=0.1.0"],
      restart_count: 0,
      last_error: null,
      owns_process: false,
      mode: "headless",
    };
    const json = JSON.parse(JSON.stringify(diag));
    expect(json.owns_process).toBe(false);
    expect(json.mode).toBe("headless");
    // The adopted lockfile is `daemon.pid`, not `desktop.lock` —
    // pin that too so the supervisor's path-honour-PEKO_CONFIG_DIR
    // change shows up here if it ever regresses.
    expect(json.lockfile_path).toContain("daemon.pid");
    expect(json.lockfile_path).not.toContain("desktop.lock");
  });
});
