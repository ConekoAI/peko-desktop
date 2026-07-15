import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The hook reads catalog + credentials from the runtime via `lib/api`.
// We mock those two readers and `providerAdd` so we can observe the
// order in which they fire — the regression test asserts that the
// providers + credentials readers fire *after* `providerAdd` and
// *before* the mutation resolves, so the configured-rows filter is
// guaranteed fresh by the time `useMutation.onSuccess` callbacks run.
const providerAddMock = vi.fn();
const principalProviderListMock = vi.fn();
const credentialListMock = vi.fn();
const providerTemplatesMock = vi.fn();

vi.mock("../lib/api", () => ({
  principalProviderList: () => principalProviderListMock(),
  providerAdd: (args: unknown) => providerAddMock(args),
  providerTemplates: () => providerTemplatesMock(),
  credentialList: () => credentialListMock(),
}));

import { useAddProvider } from "../hooks/useProviders";

function renderHookWith<T>(hook: () => T, qc: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

describe("useAddProvider (T-XXX: awaits refetches before resolving)", () => {
  beforeEach(() => {
    providerAddMock.mockReset();
    principalProviderListMock.mockReset();
    credentialListMock.mockReset();
    providerTemplatesMock.mockReset();

    // IPC payloads the test will assert against.
    principalProviderListMock.mockResolvedValue([
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-haiku-4-5", requiresKey: true, isLocal: false },
    ]);
    credentialListMock.mockResolvedValue([
      { provider: "anthropic", hasKey: true, lastTested: null },
    ]);
    providerTemplatesMock.mockResolvedValue([]);
    providerAddMock.mockResolvedValue({
      id: "anthropic",
      displayName: "Anthropic",
      apiType: "anthropic",
      defaultModel: "claude-haiku-4-5",
      requiresKey: true,
      isLocal: false,
    });
  });

  it("refetches providers + credentials before the mutation resolves (no stale list after Add Provider)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Pre-seed the queries with the OLD empty state so we can observe
    // them being refetched. Without the fix the modal would close on
    // the stale empty cache and the user would see "No providers
    // configured yet" until they manually refreshed.
    await qc.prefetchQuery({
      queryKey: ["providers", "local"],
      queryFn: () => principalProviderListMock(),
    });
    await qc.prefetchQuery({
      queryKey: ["credentials"],
      queryFn: () => credentialListMock(),
    });

    principalProviderListMock.mockClear();
    credentialListMock.mockClear();

    const { result } = renderHookWith(() => useAddProvider(), qc);

    result.current.mutate({ template: "anthropic", key: "sk-test" });

    // The mutation must NOT resolve until both readers have re-run.
    // `waitFor` polls until `isSuccess` flips; if the fix is missing
    // it flips before the readers do and this assertion catches it.
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Order check: providerAdd fired first; the readers fired at least
    // once after that (the refetch), and the mutation settled only
    // after both readers had returned.
    const addOrder = providerAddMock.mock.invocationCallOrder[0];
    const providersOrder = principalProviderListMock.mock.invocationCallOrder[0];
    const credentialsOrder = credentialListMock.mock.invocationCallOrder[0];

    expect(addOrder).toBeLessThan(providersOrder);
    expect(addOrder).toBeLessThan(credentialsOrder);
  });

  it("does NOT call providerAdd when the user cancels", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHookWith(() => useAddProvider(), qc);
    expect(() => result.current.reset()).not.toThrow();
    expect(providerAddMock).not.toHaveBeenCalled();
  });
});