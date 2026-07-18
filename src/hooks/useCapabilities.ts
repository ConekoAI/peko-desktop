import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  capabilityList,
  capabilityGrant,
  capabilityRevoke,
} from "../lib/api";

export function useCapabilities(principal: string | undefined) {
  return useQuery({
    queryKey: ["capabilities", principal],
    queryFn: () => {
      if (!principal) throw new Error("principal name required");
      return capabilityList(principal);
    },
    enabled: !!principal,
    staleTime: 10_000,
  });
}

export function useGrantCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ principal, capability }: { principal: string; capability: string }) =>
      capabilityGrant(principal, capability),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["capabilities", vars.principal] });
    },
  });
}

export function useRevokeCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ principal, capability }: { principal: string; capability: string }) =>
      capabilityRevoke(principal, capability),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["capabilities", vars.principal] });
    },
  });
}
