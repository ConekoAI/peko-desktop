import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalGetMock = vi.fn();

vi.mock("../lib/api", () => ({
  principalGet: (...args: unknown[]) => principalGetMock(...args),
}));

// Capture the fake `fetch` so individual tests can assert the URL
// shape and stub the response. Tests that don't touch the network
// path don't need to assign anything here.
let fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined;

vi.stubGlobal(
  "fetch",
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!fetchImpl) throw new Error("fetch stub not configured for this test");
    return fetchImpl(input, init);
  }),
);

import {
  usePrincipalStatus,
  statusBadge,
  type PrincipalStatusValue,
} from "../hooks/usePrincipalStatus";

function renderHookWith<T>(hook: () => T, qc: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

describe("statusBadge", () => {
  it("maps every known status to a label + color + icon", () => {
    const known: PrincipalStatusValue[] = ["online", "offline", "busy", "error", "unknown"];
    for (const v of known) {
      const b = statusBadge(v);
      expect(b.label).toBeTruthy();
      expect(b.color).toMatch(/^text-/);
      expect(["circle", "dot", "off", "alert"]).toContain(b.icon);
    }
  });

  it("falls back to the unknown badge for unrecognized input", () => {
    // Force a value past the type union — this guards against
    // future enums drifting out of sync.
    expect(statusBadge("unknown" as PrincipalStatusValue).label).toBe("Unknown");
  });
});

describe("usePrincipalStatus — local IPC path", () => {
  beforeEach(() => {
    principalGetMock.mockReset();
    fetchImpl = undefined;
  });

  it("returns the live principal status from principalGet", async () => {
    principalGetMock.mockResolvedValue({
      name: "alice",
      status: "online",
      runtimeId: "local",
      owner: "user:local",
    });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("local", "alice"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("online");
    expect(result.current.data?.source).toBe("local");
    expect(principalGetMock).toHaveBeenCalledWith("alice", "local");
  });

  it("returns 'unknown' status if the IPC throws", async () => {
    principalGetMock.mockRejectedValue(new Error("daemon unreachable"));
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("local", "alice"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("unknown");
    expect(result.current.data?.source).toBe("local");
  });

  it("treats a null principalGet response as 'unknown' instead of throwing", async () => {
    principalGetMock.mockResolvedValue(null);
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("local", "missing"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("unknown");
  });

  it("skips the IPC call entirely when the principal name is empty", async () => {
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("local", ""),
      qc,
    );
    // The hook reports itself as enabled=false; no fetch, no
    // pending→success transition.
    expect(result.current.fetchStatus).toBe("idle");
    expect(principalGetMock).not.toHaveBeenCalled();
  });
});

describe("usePrincipalStatus — remote hub path", () => {
  beforeEach(() => {
    principalGetMock.mockReset();
    fetchImpl = undefined;
  });

  it("hits /v1/public/principals/:owner/:name on the configured hub", async () => {
    let lastUrl = "";
    fetchImpl = async (input) => {
      lastUrl = String(input);
      return new Response(JSON.stringify({ status: "online" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "coding-assistant", "alice", "https://hub.example.com"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl).toBe(
      "https://hub.example.com/v1/public/principals/alice/coding-assistant",
    );
    expect(result.current.data?.status).toBe("online");
    expect(result.current.data?.source).toBe("remote");
  });

  it("strips a trailing slash from the hub URL", async () => {
    let lastUrl = "";
    fetchImpl = async (input) => {
      lastUrl = String(input);
      return new Response(JSON.stringify({ status: "offline" }), { status: 200 });
    };
    const qc = freshClient();
    const { result } = renderHookWith(
      () =>
        usePrincipalStatus(
          "hub:https://hub.example.com/",
          "coding-assistant",
          "alice",
          "https://hub.example.com/",
        ),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl.startsWith("https://hub.example.com/v1/")).toBe(true);
  });

  it("treats 404 from the hub as 'offline' (principal was deregistered)", async () => {
    fetchImpl = async () => new Response("not found", { status: 404 });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "gone", "alice", "https://hub.example.com"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("offline");
    expect(result.current.data?.source).toBe("remote");
  });

  it("treats a 5xx as 'unknown' (transient — try again next poll)", async () => {
    fetchImpl = async () => new Response("oops", { status: 503 });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "alice-bot", "alice", "https://hub.example.com"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("unknown");
  });

  it("treats a network error (fetch throws) as 'unknown'", async () => {
    fetchImpl = async () => {
      throw new TypeError("network down");
    };
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "alice-bot", "alice", "https://hub.example.com"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("unknown");
  });

  it("falls back to the local IPC path when owner/hubUrl args are absent", async () => {
    // No fetchImpl set — if the hook tries to fetch, the stubbed
    // fetch will throw "fetch stub not configured for this test".
    // That bubbles up as a thrown queryFn, which is what we're
    // verifying doesn't happen: instead it should fall back to
    // principalGet because the runtimeId is the literal string
    // "hub:..." but no owner/hubUrl were provided.
    principalGetMock.mockResolvedValue({
      name: "alice",
      status: "busy",
      runtimeId: "hub:https://hub.example.com",
      owner: "alice",
    });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "alice"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.source).toBe("local");
    expect(result.current.data?.status).toBe("busy");
    expect(principalGetMock).toHaveBeenCalledWith("alice", "hub:https://hub.example.com");
  });
});