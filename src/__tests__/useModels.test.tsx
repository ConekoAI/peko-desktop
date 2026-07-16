import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const modelListMock = vi.fn();
const modelTemplatesMock = vi.fn();
const modelAddMock = vi.fn();
const modelUpdateMock = vi.fn();
const modelRemoveMock = vi.fn();
const modelTestMock = vi.fn();
const modelReloadMock = vi.fn();

vi.mock("../lib/api", () => ({
  modelList: () => modelListMock(),
  modelTemplates: () => modelTemplatesMock(),
  modelAdd: (args: unknown) => modelAddMock(args),
  modelUpdate: (args: unknown) => modelUpdateMock(args),
  modelRemove: (id: string) => modelRemoveMock(id),
  modelTest: (id: string) => modelTestMock(id),
  modelReload: () => modelReloadMock(),
}));

import {
  useModels,
  useModelTemplates,
  useAddModel,
  useUpdateModel,
  useRemoveModel,
  useReloadModels,
} from "../hooks/useModels";

function renderHookWith<T>(hook: () => T, qc: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

describe("useModels hooks", () => {
  beforeEach(() => {
    modelListMock.mockReset();
    modelTemplatesMock.mockReset();
    modelAddMock.mockReset();
    modelUpdateMock.mockReset();
    modelRemoveMock.mockReset();
    modelTestMock.mockReset();
    modelReloadMock.mockReset();

    modelListMock.mockResolvedValue([
      {
        id: "anthropic",
        displayName: "Anthropic",
        apiFormat: "anthropic_messages",
        baseUrl: "https://api.anthropic.com",
        modelId: "claude-haiku-4-5",
        requiresKey: true,
        isLocal: false,
        enabled: true,
        capabilities: ["tool_use"],
        headers: {},
      },
    ]);
    modelTemplatesMock.mockResolvedValue([]);
    modelAddMock.mockResolvedValue({ id: "anthropic", displayName: "Anthropic" });
    modelUpdateMock.mockResolvedValue({ id: "anthropic", displayName: "Anthropic (edited)" });
    modelRemoveMock.mockResolvedValue(true);
    modelTestMock.mockResolvedValue({ id: "anthropic", ok: true, message: "ok", latencyMs: 120 });
    modelReloadMock.mockResolvedValue({ modelsCount: 1, keysCount: 1 });
  });

  describe("useModels", () => {
    it("lists configured models from modelList", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHookWith(() => useModels(), qc);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].id).toBe("anthropic");
    });
  });

  describe("useModelTemplates", () => {
    it("lists built-in presets from modelTemplates", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      modelTemplatesMock.mockResolvedValue([
        {
          id: "anthropic",
          displayName: "Anthropic",
          apiType: "anthropic",
          baseUrl: "https://api.anthropic.com",
          requiresKey: true,
          defaultModel: "claude-opus-4-7",
          models: [],
        },
      ]);
      const { result } = renderHookWith(() => useModelTemplates(), qc);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].id).toBe("anthropic");
    });
  });

  describe("useAddModel", () => {
    it("refetches the models and credentials queries after a successful add", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useAddModel(), qc);
      result.current.mutate({ template: "anthropic", custom: false, model: ["claude-opus-4-7"], key: "sk-test" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(modelAddMock).toHaveBeenCalledWith({
        template: "anthropic",
        custom: false,
        model: ["claude-opus-4-7"],
        key: "sk-test",
      });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["credentials"] });
    });

    it("does NOT call modelAdd when reset without a mutate", () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHookWith(() => useAddModel(), qc);
      expect(() => result.current.reset()).not.toThrow();
      expect(modelAddMock).not.toHaveBeenCalled();
    });
  });

  describe("useUpdateModel", () => {
    it("calls modelUpdate and refetches the model list", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useUpdateModel(), qc);
      result.current.mutate({ id: "anthropic", displayName: "Anthropic (edited)" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(modelUpdateMock).toHaveBeenCalledWith({
        id: "anthropic",
        displayName: "Anthropic (edited)",
      });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
    });
  });

  describe("useRemoveModel", () => {
    it("calls modelRemove and refetches the model list", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useRemoveModel(), qc);
      result.current.mutate("anthropic");

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(modelRemoveMock).toHaveBeenCalledWith("anthropic");
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
    });
  });

  describe("useReloadModels", () => {
    it("calls modelReload and refetches models + credentials", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const refetchSpy = vi.spyOn(qc, "refetchQueries");

      const { result } = renderHookWith(() => useReloadModels(), qc);
      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(modelReloadMock).toHaveBeenCalled();
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["credentials"] });
    });
  });
});
