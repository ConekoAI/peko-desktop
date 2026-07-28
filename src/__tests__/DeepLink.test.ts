import { describe, it, expect } from "vitest";
import { parseDeepLink } from "../lib/deepLink";

/**
 * PR #6: deep-link URL parser. Pure function — no side effects —
 * so we can pin the wire-shape contract without instantiating the
 * Tauri plugin runtime. The contract under test is the one the OS
 * hands the desktop when the user clicks a share link from another
 * app; any drift here means a real share link silently fails.
 */

describe("parseDeepLink", () => {
  describe("peko:// scheme", () => {
    it("accepts the canonical add-principal intent with a hub URL", () => {
      const inner = "https://pekohub.org/p/alice/coding-assistant";
      const url = `peko://add-principal?url=${encodeURIComponent(inner)}`;
      expect(parseDeepLink(url)).toEqual({
        kind: "add-principal",
        shareUrl: inner,
      });
    });

    it("accepts add-principal with the legacy /v1/public/principals/ URL", () => {
      const inner =
        "https://pekohub.org/v1/public/principals/alice/coding-assistant";
      const url = `peko://add-principal?url=${encodeURIComponent(inner)}`;
      expect(parseDeepLink(url)).toEqual({
        kind: "add-principal",
        shareUrl: inner,
      });
    });

    it("accepts add-principal with a token-bearing hub URL", () => {
      const inner =
        "https://pekohub.org/p/alice/coding-assistant?token=abc123";
      const url = `peko://add-principal?url=${encodeURIComponent(inner)}`;
      expect(parseDeepLink(url)).toEqual({
        kind: "add-principal",
        shareUrl: inner,
      });
    });

    it("rejects unknown peko:// hostnames", () => {
      expect(parseDeepLink("peko://open-principal/alice/coding-assistant")).toBeNull();
      expect(parseDeepLink("peko://settings")).toBeNull();
    });

    it("rejects peko://add-principal without the url= query parameter", () => {
      expect(parseDeepLink("peko://add-principal")).toBeNull();
      expect(parseDeepLink("peko://add-principal?noturl=https://x")).toBeNull();
    });

    it("rejects peko://add-principal with an empty url=", () => {
      // The plugin's URL parser treats `?url=` as `url === ""`,
      // which would surface a malformed URL to the modal — reject
      // it at the gate instead.
      expect(parseDeepLink("peko://add-principal?url=")).toBeNull();
    });
  });

  describe("https://pekohub.org share URLs", () => {
    it("accepts the canonical /p/{owner}/{name} form", () => {
      const url = "https://pekohub.org/p/alice/coding-assistant";
      expect(parseDeepLink(url)).toEqual({
        kind: "pekohub-share",
        shareUrl: url,
      });
    });

    it("accepts the legacy /v1/public/principals/{owner}/{name} form", () => {
      const url = "https://pekohub.org/v1/public/principals/alice/coding-assistant";
      expect(parseDeepLink(url)).toEqual({
        kind: "pekohub-share",
        shareUrl: url,
      });
    });

    it("accepts a token-bearing canonical URL", () => {
      const url =
        "https://pekohub.org/p/alice/coding-assistant?token=abc123";
      expect(parseDeepLink(url)).toEqual({
        kind: "pekohub-share",
        shareUrl: url,
      });
    });

    it("accepts a self-hosted hub URL", () => {
      const url = "https://hub.example.com/p/alice/coding-assistant";
      expect(parseDeepLink(url)).toEqual({
        kind: "pekohub-share",
        shareUrl: url,
      });
    });

    it("accepts plain http (not just https)", () => {
      const url = "http://localhost:8080/p/alice/coding-assistant";
      expect(parseDeepLink(url)).toEqual({
        kind: "pekohub-share",
        shareUrl: url,
      });
    });
  });

  describe("rejection paths", () => {
    it("rejects https URLs that don't match the share-link shape", () => {
      // Different path — even though the host looks right.
      expect(
        parseDeepLink("https://pekohub.org/dashboard"),
      ).toBeNull();
      expect(
        parseDeepLink("https://pekohub.org/p/alice"),
      ).toBeNull();
      expect(
        parseDeepLink("https://pekohub.org/"),
      ).toBeNull();
    });

    it("rejects unsupported protocols", () => {
      expect(
        parseDeepLink("ftp://pekohub.org/p/alice/coding-assistant"),
      ).toBeNull();
      expect(parseDeepLink("javascript:alert(1)")).toBeNull();
      expect(parseDeepLink("file:///etc/passwd")).toBeNull();
    });

    it("rejects garbage strings that don't parse as a URL", () => {
      expect(parseDeepLink("not a url")).toBeNull();
      expect(parseDeepLink("")).toBeNull();
      expect(parseDeepLink("peko:add-principal?url=x")).toBeNull(); // missing //
    });
  });
});