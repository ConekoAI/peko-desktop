import { useQuery } from "@tanstack/react-query";
import { principalProviderList } from "../lib/api";

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