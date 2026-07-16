import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  modelList,
  modelTemplates,
  modelAdd,
  modelUpdate,
  modelRemove,
  modelTest,
  modelReload,
} from "../lib/api";
import type { ModelAddArgs, ModelUpdateArgs } from "../types";

/**
 * Configured-model catalog hook. Each model is a self-contained
 * endpoint configuration (base URL, API format, wire model id,
 * headers, optional credential reference). The runtime reloads the
 * catalog and vault from disk on every query so the desktop and CLI
 * agree on the current state.
 */
export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => modelList(),
  });
}

/**
 * List the runtime's built-in model presets (formerly provider
 * templates). Presets are static, so we cache them for five minutes.
 */
export function useModelTemplates() {
  return useQuery({
    queryKey: ["model-templates"],
    queryFn: () => modelTemplates(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Add a configured model. On success we refetch the model list so
 * the new entry appears immediately, and we invalidate the generic
 * credential list because a supplied `key` may create a new vault
 * item.
 */
export function useAddModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ModelAddArgs) => modelAdd(args),
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["models"] }),
        qc.refetchQueries({ queryKey: ["credentials"] }),
      ]);
      qc.invalidateQueries({ queryKey: ["model-templates"] });
    },
  });
}

/** Update an existing configured model. */
export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ModelUpdateArgs) => modelUpdate(args),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["models"] });
    },
  });
}

/** Remove a configured model by id. */
export function useRemoveModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => modelRemove(id),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["models"] });
    },
  });
}

/** Test connectivity for a configured model. */
export function useTestModel() {
  return useMutation({
    mutationFn: (id: string) => modelTest(id),
  });
}

/**
 * Reload the runtime's model catalog and vault from disk. On success
 * we refetch the model and credential lists.
 */
export function useReloadModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => modelReload(),
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["models"] }),
        qc.refetchQueries({ queryKey: ["credentials"] }),
      ]);
    },
  });
}
