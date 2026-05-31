import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  settingsList,
  settingsSet,
  credentialGet,
  credentialSet,
  credentialDelete,
  credentialTest,
} from "../lib/api";
import type { Credential } from "../types";

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

export function useSetCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Credential) => credentialSet(payload),
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey: ["credentials", payload.provider] });
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
