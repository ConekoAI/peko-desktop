import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  settingsList,
  settingsSet,
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

// ─── Generic vault credentials ───────────────────────────────────

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => credentialTestById(id),
    onSuccess: () => {
      // A successful test updates the credential's lastTestedAt /
      // lastTestedOk fields, so refresh the list so the row shows the
      // new state without requiring a tab reload.
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useCredentialMaterial(id: string, reason: string) {
  return useQuery({
    queryKey: ["credential", id, "material", reason],
    queryFn: () => credentialGetMaterial(id, reason),
    enabled: !!id && !!reason,
  });
}
