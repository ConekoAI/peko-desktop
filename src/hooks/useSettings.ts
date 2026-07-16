import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  settingsList,
  settingsSet,
  credentialGet,
  credentialList,
  credentialSet,
  credentialDelete,
  credentialTest,
  credentialGetById,
  credentialListGeneric,
  credentialSetGeneric,
  credentialDeleteById,
  credentialTestById,
  credentialGetMaterial,
} from "../lib/api";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: settingsList,
  });
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsSet(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function useCredential(provider: string) {
  return useQuery({
    queryKey: ["credentials", provider],
    queryFn: () => credentialGet(provider),
    enabled: !!provider,
  });
}

/**
 * Enumerate every provider that has a key stored in the OS keychain.
 *
 * Powers the Settings → Credentials "configured" indicators and the
 * FirstRunWalkthrough's "your provider is already set" branch — both
 * want to know which provider ids have a `hasKey=true` row without
 * having to call `credentialGet` per provider.
 */
export function useCredentialList() {
  return useQuery({
    queryKey: ["credentials"],
    queryFn: () => credentialList(),
    staleTime: 30_000,
  });
}

/** Save a raw key for a provider. The runtime stores it in the OS keychain. */
export function useSetCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      credentialSet(provider, apiKey),
    onSuccess: (_data, { provider }) => {
      // Refresh both the per-provider lookup and the list — a fresh
      // key for a provider that wasn't in the list before (or whose
      // `hasKey` flag just flipped from false→true) needs the list
      // to re-render so the green pill appears without a tab reload.
      qc.invalidateQueries({ queryKey: ["credentials", provider] });
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => credentialDelete(provider),
    onSuccess: (_data, provider) => {
      qc.invalidateQueries({ queryKey: ["credentials", provider] });
      // T-109b redesign: also invalidate the list so the orphan
      // strip + the per-row "Key set" indicator both re-render when
      // the last configured key is removed.
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useTestCredential() {
  return useMutation({
    mutationFn: (provider: string) => credentialTest(provider),
  });
}

// ─── RP4 generic credential hooks (RP6 UI will consume these) ─────

export function useCredentialById(id: string | undefined) {
  return useQuery({
    queryKey: ["credential", id],
    queryFn: () => credentialGetById(id!),
    enabled: !!id,
  });
}

export function useGenericCredentialList(
  namespace?: string,
  kind?: string,
) {
  return useQuery({
    queryKey: ["credentials", "generic", namespace ?? "*", kind ?? "*"],
    queryFn: () => credentialListGeneric(namespace, kind),
    staleTime: 30_000,
  });
}

export function useSetGenericCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      namespace: string;
      name: string;
      kind: import("../types").CredentialKind;
      material: string;
      metadata?: Record<string, unknown>;
    }) => credentialSetGeneric(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useDeleteCredentialById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => credentialDeleteById(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credentials"] });
      qc.invalidateQueries({ queryKey: ["credential"] });
    },
  });
}

export function useTestCredentialById() {
  return useMutation({
    mutationFn: (id: string) => credentialTestById(id),
  });
}

export function useCredentialMaterial(id: string, reason: string) {
  return useQuery({
    queryKey: ["credential", id, "material", reason],
    queryFn: () => credentialGetMaterial(id, reason),
    enabled: !!id && !!reason,
  });
}
