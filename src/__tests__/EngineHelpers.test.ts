import { describe, it, expect } from "vitest";
import {
  engineStateTone,
  engineStateLabel,
  engineStateSubtitle,
  engineStateIsProblem,
} from "../lib/engine-helpers";
import type { EngineState } from "../types";

/**
 * Tests for the small UI helpers that drive the engine badge,
 * status-bar footer, and the dashboard banner. The helpers are
 * intentionally pure (EngineState → string/number) so they stay
 * testable without a Tauri runtime.
 */

const running: EngineState = {
  kind: "running",
  pid: 4242,
  version: "0.1.0",
  uptime_secs: 12,
};
const starting: EngineState = { kind: "starting" };
const restarting: EngineState = { kind: "restarting", attempt: 1 };
const restartingHigh: EngineState = { kind: "restarting", attempt: 3 };
const stopped: EngineState = { kind: "stopped" };
const failed: EngineState = { kind: "failed", message: "boom" };

describe("engineStateTone", () => {
  it("returns ok for running", () => {
    expect(engineStateTone(running)).toBe("ok");
  });

  it("returns warn for transient mid-cycle states", () => {
    expect(engineStateTone(starting)).toBe("warn");
    expect(engineStateTone(restarting)).toBe("warn");
  });

  it("returns error for terminal bad states", () => {
    expect(engineStateTone(stopped)).toBe("error");
    expect(engineStateTone(failed)).toBe("error");
  });

  it("returns warn when state is undefined (first paint before fetch)", () => {
    expect(engineStateTone(undefined)).toBe("warn");
  });
});

describe("engineStateLabel", () => {
  it("returns Running for running state", () => {
    expect(engineStateLabel(running)).toBe("Running");
  });

  it("returns transient labels without numbers when attempt is 1", () => {
    expect(engineStateLabel(starting)).toBe("Starting");
    expect(engineStateLabel(restarting)).toBe("Restarting…");
  });

  it("includes attempt count when above 1", () => {
    expect(engineStateLabel(restartingHigh)).toBe("Restarting (3)…");
  });

  it("returns terminal labels", () => {
    expect(engineStateLabel(stopped)).toBe("Stopped");
    expect(engineStateLabel(failed)).toBe("Failed");
  });

  it("returns Connecting… when state is undefined", () => {
    expect(engineStateLabel(undefined)).toBe("Connecting…");
  });
});

describe("engineStateSubtitle", () => {
  it("includes version and PID for running", () => {
    expect(engineStateSubtitle(running)).toBe("v0.1.0 · PID 4242");
  });

  it("returns human strings for transient states", () => {
    expect(engineStateSubtitle(starting)).toBe(
      "Waiting for engine handshake",
    );
    expect(engineStateSubtitle(restarting)).toBe(
      "Engine exited unexpectedly; supervisor is restarting it",
    );
  });

  it("returns the failure message for failed", () => {
    expect(engineStateSubtitle(failed)).toBe("boom");
  });

  it("returns 'Engine is not running' for stopped and null only for undefined", () => {
    // We surface a friendly copy for `stopped` so the badge isn't
    // empty after the supervisor reports Stopped (e.g., after an
    // app exit). Undefined is the pre-fetch case where the helper
    // explicitly hides its subtitle to avoid an empty row.
    expect(engineStateSubtitle(stopped)).toBe("Engine is not running");
    expect(engineStateSubtitle(undefined)).toBeNull();
  });
});

describe("engineStateIsProblem", () => {
  it("is true only for failed", () => {
    expect(engineStateIsProblem(failed)).toBe(true);
    expect(engineStateIsProblem(running)).toBe(false);
    expect(engineStateIsProblem(starting)).toBe(false);
    expect(engineStateIsProblem(restarting)).toBe(false);
    expect(engineStateIsProblem(stopped)).toBe(false);
    expect(engineStateIsProblem(undefined)).toBe(false);
  });
});
