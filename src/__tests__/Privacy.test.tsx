// What the app reports about itself (pekohub ADR-014): the privacy screen
// shows once with both switches on, nothing is saved as agreed until
// Continue, and a crash report carries an error's class and stack but not
// a message that could quote a name, a path or a reply.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const invoke = vi.fn((_cmd: string, _args?: unknown) => Promise.resolve(null));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  Channel: class {},
}));

const privacy: { data: { acknowledged: boolean; crashReports: boolean; usageEvents: boolean } | undefined } = {
  data: undefined,
};
const mutate = vi.fn();
vi.mock("../hooks/usePrivacy", () => ({
  usePrivacy: () => privacy,
  useSetPrivacy: () => ({ mutate, isPending: false, error: null }),
}));

import PrivacyNotice from "../components/PrivacyNotice";
import PrivacySettings from "../components/PrivacySettings";
import {
  describeError,
  parseStack,
  reportError,
  resetReportCount,
} from "../lib/errorReporting";

beforeEach(() => {
  mutate.mockReset();
  invoke.mockClear();
  resetReportCount();
});

describe("PrivacyNotice", () => {
  it("shows once, with both switches on, and saves what was picked on Continue", () => {
    privacy.data = { acknowledged: false, crashReports: true, usageEvents: true };
    render(<PrivacyNotice />);
    const crash = screen.getByTestId("privacy-crash-toggle") as HTMLInputElement;
    const usage = screen.getByTestId("privacy-usage-toggle") as HTMLInputElement;
    expect(crash.checked && usage.checked).toBe(true);

    fireEvent.click(usage);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("privacy-notice-continue"));
    expect(mutate.mock.calls[0][0]).toEqual({
      acknowledged: true,
      crashReports: true,
      usageEvents: false,
    });
  });

  it("stays away once passed, and while the choices are not yet read", () => {
    privacy.data = { acknowledged: true, crashReports: true, usageEvents: true };
    const { unmount } = render(<PrivacyNotice />);
    expect(screen.queryByTestId("privacy-notice")).toBeNull();
    unmount();
    privacy.data = undefined;
    render(<PrivacyNotice />);
    expect(screen.queryByTestId("privacy-notice")).toBeNull();
  });
});

describe("PrivacySettings", () => {
  it("saves a switch as soon as it is turned", () => {
    privacy.data = { acknowledged: true, crashReports: true, usageEvents: true };
    render(<PrivacySettings />);
    fireEvent.click(screen.getByTestId("privacy-crash-toggle"));
    expect(mutate.mock.calls[0][0]).toEqual({
      acknowledged: true,
      crashReports: false,
      usageEvents: true,
    });
  });
});

describe("crash reports from the window", () => {
  it("reads both engines' stack lines and keeps only the path inside the app", () => {
    const chromium = [
      "TypeError: x is undefined",
      "    at render (http://tauri.localhost/assets/index-abc.js?v=2:10:200)",
      "    at http://tauri.localhost/assets/index-abc.js:1:5",
    ].join("\n");
    expect(parseStack(chromium)).toEqual([
      { function: "render", file: "assets/index-abc.js", line: 10, column: 200 },
      { function: null, file: "assets/index-abc.js", line: 1, column: 5 },
    ]);
    const webkit = "render@tauri://localhost/assets/index-abc.js:10:200\n@tauri://localhost/assets/index-abc.js:1:5";
    expect(parseStack(webkit)).toEqual([
      { function: "render", file: "assets/index-abc.js", line: 10, column: 200 },
      { function: null, file: "assets/index-abc.js", line: 1, column: 5 },
    ]);
  });

  it("keeps the message of the engine's own errors and drops any other", () => {
    expect(describeError(new TypeError("x is undefined"))?.message).toBe("x is undefined");
    const other = describeError(new Error("could not open /Users/ada/notes for peko Momo"));
    expect(other?.name).toBe("Error");
    expect(other?.message).toBeNull();
    expect(describeError("a plain string")).toBeNull();
  });

  it("hands an error to the native side, and stops after twenty in one run", () => {
    for (let i = 0; i < 25; i += 1) reportError(new RangeError("too deep"));
    expect(invoke).toHaveBeenCalledTimes(20);
    const [cmd, args] = invoke.mock.calls[0];
    expect(cmd).toBe("report_ui_error");
    expect(args).toMatchObject({ name: "RangeError", message: "too deep" });
    reportError("not an error");
    expect(invoke).toHaveBeenCalledTimes(20);
  });
});
