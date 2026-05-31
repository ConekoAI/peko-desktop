import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  registrySearch,
  registryPull,
  registryAuthStatus,
  registryLogin,
  registryLogout,
} from "../lib/api";

export function useRegistrySearch(query: string, page: number, perPage: number) {
  return useQuery({
    queryKey: ["registry", "search", query, page, perPage],
    queryFn: () => registrySearch(query, page, perPage),
    enabled: query.length > 0,
  });
}

export function useRegistryPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => registryPull(ref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useAuthStatus() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["registry", "auth"],
    queryFn: registryAuthStatus,
  });

  const login = useMutation({
    mutationFn: ({ username, token }: { username: string; token: string }) =>
      registryLogin(username, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registry", "auth"] }),
  });

  const logout = useMutation({
    mutationFn: () => registryLogout(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registry", "auth"] }),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    login,
    logout,
  };
}
