import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  principalProviderList,
  providerAdd,
  providerRemove,
  providerSetDefault,
  providerTemplates,
  providerUpdate,
} from "../lib/api";
import type { ProviderAddArgs, ProviderUpdateArgs } from "../types";

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
  return useQuery({
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
//
// We *await* the refetches (rather than fire-and-forget) so the
// mutation's `onSuccess` doesn't resolve until the new provider is
// actually visible in the cache. Without this, `useMutation`'s
// `onSuccess` callback chain (including the modal's `onClose`) runs
// before the background refetch completes, and the configured-rows
// filter keeps showing its pre-add state — the user would see "No
// providers configured yet" until they manually refreshed the tab.
// Awaiting the refetches closes the modal only after the new entry
// is in the React Query cache.
export function useAddProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ProviderAddArgs) => providerAdd(args),
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["providers"] }),
        qc.refetchQueries({ queryKey: ["credentials"] }),
      ]);
      // Templates is static today, so a fire-and-forget invalidate is
      // fine — it's here for the day the templates list goes dynamic.
      qc.invalidateQueries({ queryKey: ["provider-templates"] });
    },
  });
}

// RP6: update an existing provider catalog entry. On success we refetch
// the catalog so the list and any open edit modal see the merged
// result immediately.
export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ProviderUpdateArgs) => providerUpdate(args),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["providers"] });
    },
  });
}

// RP6: remove a provider from the runtime catalog. On success we
// refetch the catalog and the credentials list (orphaned keys may
// change state).
export function useRemoveProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => providerRemove(id),
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["providers"] }),
        qc.refetchQueries({ queryKey: ["credentials"] }),
      ]);
    },
  });
}

// RP6: promote a provider+model to the runtime default. On success we
// refetch the catalog so the UI can render the default star.
export function useSetDefaultProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, model }: { provider: string; model?: string }) =>
      providerSetDefault(provider, model),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["providers"] });
    },
  });
}
