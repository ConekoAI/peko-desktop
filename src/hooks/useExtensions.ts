import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  extensionList,
  extensionInstall,
  extensionUninstall,
} from "../lib/api";

export function useExtensions() {
  return useQuery({
    queryKey: ["extensions"],
    queryFn: extensionList,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useInstallExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => extensionInstall(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useUninstallExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => extensionUninstall(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}