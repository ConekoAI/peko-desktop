import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamList, teamShow, teamCreate, teamRemove } from "../lib/api";

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: teamList,
  });
}

export function useTeam(name: string) {
  return useQuery({
    queryKey: ["teams", name],
    queryFn: () => teamShow(name),
    enabled: !!name,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof teamCreate>[0]) => teamCreate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useRemoveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => teamRemove(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}
