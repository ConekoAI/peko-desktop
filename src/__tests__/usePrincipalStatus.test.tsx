import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalGetMock = vi.fn();

const profileMock = vi.fn();

vi.mock("../lib/api", () => ({
  principalGet: (...args: unknown[]) => principalGetMock(...args),
  remotePrincipalProfile: (...args: unknown[]) => profileMock(...args),
}));

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
    profileMock.mockReset();
  });

  const remote = (name = "remy") =>
    usePrincipalStatus("hub:https://hub.example.com", name, "alice", "https://hub.example.com");

  it("reads the hub record through the backend, not the webview", async () => {
    profileMock.mockResolvedValue({
      status: "online",
      avatar: null,
      description: null,
      localId: null,
    });
    const { result } = renderHookWith(() => remote("coding-assistant"), freshClient());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(profileMock).toHaveBeenCalledWith("https://hub.example.com", "alice", "coding-assistant");
    expect(result.current.data?.status).toBe("online");
    expect(result.current.data?.source).toBe("remote");
  });

  it("carries the peko's public face: avatar, description, and id", async () => {
    profileMock.mockResolvedValue({
      status: "online",
      avatar: "🦊",
      description: "Finds things",
      localId: "prin_123",
    });
    const { result } = renderHookWith(() => remote(), freshClient());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.profile).toEqual({
      avatar: "🦊",
      description: "Finds things",
      localId: "prin_123",
    });
  });

  it("treats a peko the hub no longer has as 'offline'", async () => {
    profileMock.mockResolvedValue(null);
    const { result } = renderHookWith(() => remote("gone"), freshClient());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("offline");
    expect(result.current.data?.source).toBe("remote");
  });

  it("treats a failed lookup as 'unknown' (try again next poll)", async () => {
    profileMock.mockRejectedValue("pekohub error: 503 Service Unavailable");
    const { result } = renderHookWith(() => remote(), freshClient());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("unknown");
  });

  it("falls back to the local IPC path when owner/hubUrl args are absent", async () => {
    principalGetMock.mockResolvedValue({
      name: "alice",
      status: "busy",
      runtimeId: "hub:https://hub.example.com",
      owner: "alice",
    });
    const { result } = renderHookWith(
      () => usePrincipalStatus("hub:https://hub.example.com", "alice"),
      freshClient(),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.source).toBe("local");
    expect(result.current.data?.status).toBe("busy");
    expect(principalGetMock).toHaveBeenCalledWith("alice", "hub:https://hub.example.com");
    expect(profileMock).not.toHaveBeenCalled();
  });
});
