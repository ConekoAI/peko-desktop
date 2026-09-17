import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { principalReload, registrySearch, registryPull } from "../lib/api";

// ─── Seed registry (pekohub ADR-006) ─────────────────────────────
//
// PekoHub is a seed-only registry: the distributable artifact is a
// "seed" (a `.seed.toml` principal definition), not a
// bundle/template. The mechanics are unchanged — search hits the
// hub's `/api/v1/search`, install pulls the artifact with the
// runtime's `principal_pull` — only the naming moved. The flow is
// "Pull seed" → "Create peko from seed" (`peko create -s`).
//
// Create-from-seed is CLI-local: the runtime's `principal_create`
// IPC packet has no seed field (`peko-rs/core/src/ipc/packet.rs`),
// and the desktop's `principal_create` Tauri command fails loudly
// when a seed is passed. So after a pull the Registry page shows a
// "create from this seed" panel with the copyable CLI command plus a
// refresh button (`usePrincipalReload`) — never an in-app create
// button.

export function useRegistrySearch(query: string, page: number, perPage: number) {
  return useQuery({
    queryKey: ["registry", "search", query, page, perPage],
    queryFn: () => registrySearch(query, page, perPage),
    enabled: query.length > 0,
  });
}

/**
 * Pull a seed from the registry onto the local runtime. The result
 * carries the pulled `{ name, version, digest }` triple, which the
 * Registry page renders into the post-pull "create from this seed"
 * panel. A pull changes nothing in the desktop's query caches (the
 * peko only exists after the CLI create), so no invalidation runs
 * here.
 */
export function useRegistryPull() {
  return useMutation({
    mutationFn: (ref: string) => registryPull(ref),
  });
}

/**
 * Reload the runtime's in-memory principal manager from disk and
 * refresh the `["principals"]` list. The Registry page's post-pull
 * panel offers this as its refresh button: once the user has grounded
 * the seed with the CLI (`peko create <name> -s …`), the runtime
 * requires a `principal_reload` before the new peko shows up in the
 * desktop.
 */
export function usePrincipalReload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => principalReload(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["principals"] }),
  });
}
