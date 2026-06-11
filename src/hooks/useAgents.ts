import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  agentList,
  agentShow,
  agentCreate,
  agentUpdate,
  agentRemove,
  agentExport,
  agentImport,
  agentSetStatus,
  agentSetExposure,
  providerList,
} from "../lib/api";

export function useAgents(runtimeId?: string) {
  return useQuery({
    queryKey: ["agents", runtimeId ?? "local"],
    queryFn: () => agentList(runtimeId),
  });
}

export function useAgent(name: string, runtimeId?: string) {
  return useQuery({
    queryKey: ["agents", runtimeId ?? "local", name],
    queryFn: () => agentShow(name, runtimeId),
    enabled: !!name,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof agentCreate>[0]) => agentCreate(payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      runtimeId,
      payload,
    }: {
      name: string;
      runtimeId?: string;
      payload: Parameters<typeof agentUpdate>[2];
    }) => agentUpdate(name, runtimeId, payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local", variables.name] });
    },
  });
}

export function useRemoveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, runtimeId }: { name: string; runtimeId?: string }) =>
      agentRemove(name, runtimeId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
    },
  });
}

export function useExportAgent() {
  return useMutation({
    mutationFn: ({ name, runtimeId }: { name: string; runtimeId?: string }) =>
      agentExport(name, runtimeId),
  });
}

export function useImportAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, runtimeId }: { path: string; runtimeId?: string }) =>
      agentImport(path, runtimeId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
    },
  });
}

export function useSetAgentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      status,
      runtimeId,
    }: {
      name: string;
      status: string;
      runtimeId?: string;
    }) => agentSetStatus(name, status, runtimeId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local", variables.name] });
    },
  });
}

export function useSetAgentExposure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      exposure,
      runtimeId,
    }: {
      name: string;
      exposure: string;
      runtimeId?: string;
    }) => agentSetExposure(name, exposure, runtimeId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.runtimeId ?? "local", variables.name] });
    },
  });
}

export function useProviders(runtimeId?: string) {
  return useQuery({
    queryKey: ["providers", runtimeId ?? "local"],
    queryFn: () => providerList(runtimeId),
  });
}
