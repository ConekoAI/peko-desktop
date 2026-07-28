import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";

// Mutable signals for the IPC + flow helpers.
const pekohubLogoutMock = vi.fn();
const credentialGetRawMock = vi.fn();

vi.mock("../lib/api", () => ({
  pekohubLogout: () => pekohubLogoutMock(),
  credentialGetRaw: () => credentialGetRawMock(),
}));

import {
  usePekohubBundle,
  usePekohubLogout,
  writeActiveFlow,
  readActiveFlow,
} from "../hooks/useRuntimes";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePekohubBundle (D4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    pekohubLogoutMock.mockReset();
    credentialGetRawMock.mockReset();
  });

  it("returns the loaded bundle", async () => {
    credentialGetRawMock.mockResolvedValue(
      JSON.stringify({ access_token: "abc", refresh_token: "rt" }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePekohubBundle(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      access_token: "abc",
      refresh_token: "rt",
    });
  });

  it("returns null when no bundle is stored", async () => {
    credentialGetRawMock.mockResolvedValue(null);
    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePekohubBundle(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("usePekohubLogout (D4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    pekohubLogoutMock.mockReset();
    credentialGetRawMock.mockReset();
  });

  it("calls the Tauri command and clears the persisted flow", async () => {
    pekohubLogoutMock.mockResolvedValue(undefined);
    writeActiveFlow({
      verifier: "v",
      state: "s",
      redirectUri: "http://localhost:0/callback",
      baseUrl: "https://hub.example.com",
    });
    expect(readActiveFlow()).not.toBeNull();

    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePekohubLogout(), { wrapper });

    await act(async () => {
      result.current.mutate();
      await Promise.resolve();
    });

    expect(pekohubLogoutMock).toHaveBeenCalledTimes(1);
    // The onSuccess hook clears sessionStorage; the mutation
    // resolves through React Query's microtask path.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(readActiveFlow()).toBeNull();
  });

  it("does not clear the flow if the Tauri command rejects", async () => {
    pekohubLogoutMock.mockRejectedValue(new Error("ipc disconnected"));
    writeActiveFlow({
      verifier: "v",
      state: "s",
      redirectUri: "http://localhost:0/callback",
      baseUrl: "https://hub.example.com",
    });

    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePekohubLogout(), { wrapper });

    await act(async () => {
      result.current.mutate();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(pekohubLogoutMock).toHaveBeenCalledTimes(1);
    // onSuccess did NOT run — flow is intact so the user can retry.
    expect(readActiveFlow()).not.toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
