import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { principalProviderList, providerAdd, providerTemplates } from "../lib/api";
import type { ProviderAddArgs, ProviderTemplate } from "../types";

/**
 * Provider catalog hook. The catalog lives under
 * `principal_provider_list` (moved from the retired `agent::provider_list`
 * in peko-runtime PR #125). Principals reference catalog entries by
 * id from their `principal.toml` `preferred_provider_id` soft hint.
 */
export function useProviders(runtimeId?: string) {
  return useQuery({
    queryKey: ["providers", runtimeId ?? "local"],
    queryFn: () => principalProviderList(),
  });
}

// T-109b: list the runtime's built-in provider templates. Used by the
// "Add Provider" modal's template picker. Templates are static
// (compiled into the sidecar binary via `BUILT_IN_TEMPLATES`) so we
// keep them around for 5 minutes — they don't change at runtime.
export function useProviderTemplates() {
  return useQuery<ProviderTemplate[]>({
    queryKey: ["provider-templates"],
    queryFn: () => providerTemplates(),
    staleTime: 5 * 60_000,
  });
}

// T-109b: add a provider to the runtime catalog. On success we
// invalidate the catalog (`["providers"]`) so the new entry shows up in
// the existing pill list without a manual refresh, the templates list
// (currently static, but cheap to keep in sync in case it ever goes
// dynamic), and `["credentials"]` so a supplied `key` paints the
// green "Key set" pill immediately.
export function useAddProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ProviderAddArgs) => providerAdd(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["provider-templates"] });
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}
