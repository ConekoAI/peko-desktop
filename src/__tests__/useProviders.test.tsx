import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const providerAddMock = vi.fn();
const providerUpdateMock = vi.fn();
const providerRemoveMock = vi.fn();
const providerSetDefaultMock = vi.fn();
const principalProviderListMock = vi.fn();
const credentialListMock = vi.fn();
const providerTemplatesMock = vi.fn();

vi.mock("../lib/api", () => ({
  principalProviderList: () => principalProviderListMock(),
  providerAdd: (args: unknown) => providerAddMock(args),
  providerUpdate: (args: unknown) => providerUpdateMock(args),
  providerRemove: (id: string) => providerRemoveMock(id),
  providerSetDefault: (provider: string, model?: string) =>
    providerSetDefaultMock(provider, model),
  providerTemplates: () => providerTemplatesMock(),
  credentialList: () => credentialListMock(),
}));

import {
  useAddProvider,
  useUpdateProvider,
  useRemoveProvider,
  useSetDefaultProvider,
} from "../hooks/useProviders";

function renderHookWith<T>(hook: () => T, qc: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

describe("useProviders mutations", () => {
  beforeEach(() => {
    providerAddMock.mockReset();
    providerUpdateMock.mockReset();
    providerRemoveMock.mockReset();
    providerSetDefaultMock.mockReset();
    principalProviderListMock.mockReset();
    credentialListMock.mockReset();
    providerTemplatesMock.mockReset();

    principalProviderListMock.mockResolvedValue([
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-haiku-4-5", requiresKey: true, isLocal: false },
    ]);
    credentialListMock.mockResolvedValue([
      { provider: "anthropic", hasKey: true, lastTested: null },
    ]);
    providerTemplatesMock.mockResolvedValue([]);
    providerAddMock.mockResolvedValue({ id: "anthropic", displayName: "Anthropic" });
    providerUpdateMock.mockResolvedValue({ id: "anthropic", displayName: "Anthropic (edited)" });
    providerRemoveMock.mockResolvedValue(true);
    providerSetDefaultMock.mockResolvedValue({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  describe("useAddProvider", () => {
    it("refetches the providers and credentials queries after a successful add", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useAddProvider(), qc);
      result.current.mutate({ template: "anthropic", key: "sk-test" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(providerAddMock).toHaveBeenCalledWith({ template: "anthropic", key: "sk-test" });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["credentials"] });
    });

    it("does NOT call providerAdd when reset without a mutate", () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHookWith(() => useAddProvider(), qc);
      expect(() => result.current.reset()).not.toThrow();
      expect(providerAddMock).not.toHaveBeenCalled();
    });
  });

  describe("useUpdateProvider", () => {
    it("calls providerUpdate and refetches the catalog", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useUpdateProvider(), qc);
      result.current.mutate({ id: "anthropic", displayName: "Anthropic (edited)" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(providerUpdateMock).toHaveBeenCalledWith({
        id: "anthropic",
        displayName: "Anthropic (edited)",
      });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
    });
  });

  describe("useRemoveProvider", () => {
    it("calls providerRemove and refetches catalog + credentials", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useRemoveProvider(), qc);
      result.current.mutate("anthropic");

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(providerRemoveMock).toHaveBeenCalledWith("anthropic");
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["credentials"] });
    });
  });

  describe("useSetDefaultProvider", () => {
    it("calls providerSetDefault and refetches the catalog", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useSetDefaultProvider(), qc);
      result.current.mutate({ provider: "anthropic" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(providerSetDefaultMock).toHaveBeenCalledWith("anthropic", undefined);
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
    });

    it("passes the optional model through to providerSetDefault", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHookWith(() => useSetDefaultProvider(), qc);

      result.current.mutate({ provider: "anthropic", model: "claude-opus-4-7" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(providerSetDefaultMock).toHaveBeenCalledWith("anthropic", "claude-opus-4-7");
    });
  });
});
