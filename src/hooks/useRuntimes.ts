import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  runtimeList,
  runtimeAdd,
  runtimeRemove,
  runtimeReconnect,
  runtimeRename,
} from "../lib/api";

export function useRuntimes() {
  return useQuery({
    queryKey: ["runtimes"],
    queryFn: runtimeList,
    refetchInterval: 30000,
  });
}

export function useAddRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string; pekohubUrl?: string }) =>
      runtimeAdd(payload.id, payload.name, payload.pekohubUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useRemoveRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runtimeRemove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useReconnectRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runtimeReconnect(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useRenameRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string }) =>
      runtimeRename(payload.id, payload.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}
