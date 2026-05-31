import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cronList, cronRun, cronRemove } from "../lib/api";

export function useCron() {
  return useQuery({
    queryKey: ["cron"],
    queryFn: cronList,
    refetchInterval: 30000,
  });
}

export function useRunCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cronRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useRemoveCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cronRemove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}
