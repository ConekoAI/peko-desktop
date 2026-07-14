import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  settingsList,
  settingsSet,
  credentialGet,
  credentialList,
  credentialSet,
  credentialDelete,
  credentialTest,
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
      qc.invalidateQueries({ queryKey: ["credentials", provider] });
    },
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => credentialDelete(provider),
    onSuccess: (_data, provider) => {
      qc.invalidateQueries({ queryKey: ["credentials", provider] });
    },
  });
}

export function useTestCredential() {
  return useMutation({
    mutationFn: (provider: string) => credentialTest(provider),
  });
}
