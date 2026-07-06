import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  settingsList,
  settingsSet,
  credentialGet,
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
