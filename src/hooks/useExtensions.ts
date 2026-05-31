import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  extensionList,
  extensionInstall,
  extensionEnable,
  extensionDisable,
  extensionUninstall,
} from "../lib/api";

export function useExtensions() {
  return useQuery({
    queryKey: ["extensions"],
    queryFn: extensionList,
  });
}

export function useInstallExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => extensionInstall(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useEnableExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => extensionEnable(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useDisableExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => extensionDisable(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useUninstallExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => extensionUninstall(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}
