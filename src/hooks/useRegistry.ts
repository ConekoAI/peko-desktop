import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { registrySearch, registryPull } from "../lib/api";

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