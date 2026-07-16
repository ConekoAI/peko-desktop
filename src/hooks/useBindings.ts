import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bindingList,
  bindingGet,
  bindingSet,
  bindingDelete,
  bindingTestRotation,
} from "../lib/api";
import type { RotationBinding, BindingTestResult } from "../types";

export function useBindingList() {
  return useQuery({
    queryKey: ["bindings"],
    queryFn: () => bindingList(),
    staleTime: 30_000,
  });
}

export function useBinding(key: string | undefined) {
  return useQuery({
    queryKey: ["binding", key],
    queryFn: () => bindingGet(key!),
    enabled: !!key,
  });
}

export function useSetBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      key: string;
      strategy: RotationBinding["strategy"];
      order: string[];
    }) => bindingSet(payload.key, payload.strategy, payload.order),
    onSuccess: (_data, { key }) => {
      qc.invalidateQueries({ queryKey: ["bindings"] });
      qc.invalidateQueries({ queryKey: ["binding", key] });
    },
  });
}

export function useDeleteBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => bindingDelete(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bindings"] });
    },
  });
}

export function useTestBindingRotation() {
  return useMutation({
    mutationFn: (key: string) => bindingTestRotation(key),
  });
}

export type { RotationBinding, BindingTestResult };
