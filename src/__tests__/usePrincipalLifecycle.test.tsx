// Removing a peko takes it, and its thread, out of the cache at once,
// so no view falls back to it; creating one lists it at once, so the
// chat that opens next finds it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalRemoveMock = vi.fn();
const principalCreateMock = vi.fn();
const principalListMock = vi.fn();

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  principalRemove: (name: string, rid: unknown) => principalRemoveMock(name, rid),
  principalCreate: (req: unknown) => principalCreateMock(req),
  principalList: (rid: unknown) => principalListMock(rid),
}));

import { usePrincipalCreate, usePrincipalRemove } from "../hooks/usePrincipals";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["principals", "local"], [{ name: "alex" }, { name: "juno" }]);
  qc.setQueryData(["principal-log", "local", "alex", "user:local"], { messages: [] });
  qc.setQueryData(["principal-log", "local", "juno", "user:local"], { messages: [] });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  for (const m of [principalRemoveMock, principalCreateMock, principalListMock]) m.mockReset();
  // The refetch after invalidation never resolves: the test reads the
  // cache as the mutation left it.
  principalListMock.mockReturnValue(new Promise(() => {}));
});

describe("peko lifecycle cache", () => {
  it("drops a removed peko and its thread at once", async () => {
    principalRemoveMock.mockResolvedValue(undefined);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePrincipalRemove(), { wrapper });
    await act(() => result.current.mutateAsync({ name: "alex" }));

    expect(qc.getQueryData(["principals", "local"])).toEqual([{ name: "juno" }]);
    expect(qc.getQueryData(["principal-log", "local", "alex", "user:local"])).toBeUndefined();
    expect(qc.getQueryData(["principal-log", "local", "juno", "user:local"])).toBeDefined();
  });

  it("lists a created peko at once", async () => {
    principalCreateMock.mockResolvedValue({ name: "nova", bootState: "organized" });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePrincipalCreate(), { wrapper });
    await act(() => result.current.mutateAsync({ name: "nova", modelId: "m" }));

    expect(
      (qc.getQueryData(["principals", "local"]) as { name: string }[]).map((p) => p.name),
    ).toEqual(["alex", "juno", "nova"]);
  });
});
