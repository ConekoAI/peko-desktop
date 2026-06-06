import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamList, teamShow, teamCreate, teamRemove, teamJoin, teamLeave } from "../lib/api";

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

export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ team, agent }: { team: string; agent: string }) => teamJoin(team, agent),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["teams", vars.team] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", vars.agent] });
    },
  });
}

export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ team, agent }: { team: string; agent: string }) => teamLeave(team, agent),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["teams", vars.team] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", vars.agent] });
    },
  });
}
