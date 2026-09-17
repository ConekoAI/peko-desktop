import { describe, it, expect } from "vitest";
import {
  ChannelError,
  classifyChannelError,
  isChannelForbidden,
} from "../lib/channelErrors";

/**
 * Channel membership-gate error classification (peko-runtime
 * ADR-058). Channel reads/posts refuse non-members with a
 * `[forbidden]`-style message; the classifier must turn those raw
 * IPC rejections into a typed `ChannelError` the UI can switch on,
 * while passing ordinary failures through untouched.
 */
describe("classifyChannelError", () => {
  it("marks the runtime's [forbidden] prefix as forbidden", () => {
    const err = classifyChannelError("[forbidden] sender_name user:1 is not allowed");
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.kind).toBe("forbidden");
    expect(err.forbidden).toBe(true);
    expect(err.message).toBe("[forbidden] sender_name user:1 is not allowed");
  });

  it("is case-insensitive on the [forbidden] tag", () => {
    expect(classifyChannelError("[Forbidden] nope").kind).toBe("forbidden");
  });

  it("marks membership-gate phrasing as forbidden", () => {
    expect(classifyChannelError("principal is not a member of chan_alpha").kind).toBe(
      "forbidden",
    );
    expect(classifyChannelError("membership check failed").kind).toBe("forbidden");
    expect(classifyChannelError("permission denied").kind).toBe("forbidden");
  });

  it("passes ordinary failures through as unknown, preserving the message", () => {
    const err = classifyChannelError(new Error("daemon unreachable"));
    expect(err.kind).toBe("unknown");
    expect(err.forbidden).toBe(false);
    expect(err.message).toBe("daemon unreachable");
  });

  it("stringifies non-Error rejections (Tauri rejects with plain strings)", () => {
    const err = classifyChannelError("channel chan_alpha not found");
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.kind).toBe("unknown");
    expect(err.message).toBe("channel chan_alpha not found");
  });

  it("classifies string rejections carrying the gate phrasing", () => {
    expect(classifyChannelError("[forbidden] not a member").kind).toBe("forbidden");
  });
});

describe("isChannelForbidden", () => {
  it("is true only for forbidden ChannelErrors", () => {
    expect(isChannelForbidden(classifyChannelError("[forbidden] x"))).toBe(true);
    expect(isChannelForbidden(classifyChannelError("boom"))).toBe(false);
    expect(isChannelForbidden(new Error("[forbidden] x"))).toBe(false);
    expect(isChannelForbidden(undefined)).toBe(false);
  });
});
