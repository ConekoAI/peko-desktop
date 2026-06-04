import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  agentList,
  agentShow,
  agentCreate,
  agentRemove,
  agentExport,
  agentImport,
  providerList,
} from "../lib/api";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: agentList,
  });
}

export function useAgent(name: string) {
  return useQuery({
    queryKey: ["agents", name],
    queryFn: () => agentShow(name),
    enabled: !!name,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof agentCreate>[0]) => agentCreate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useRemoveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentRemove(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useExportAgent() {
  return useMutation({
    mutationFn: (name: string) => agentExport(name),
  });
}

export function useImportAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => agentImport(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: providerList,
  });
}
