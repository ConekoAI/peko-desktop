import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cronList, cronRun, cronRemove, cronAdd } from "../lib/api";

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

export function useAddCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof cronAdd>[0]) => cronAdd(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}
