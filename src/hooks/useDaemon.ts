import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { daemonStart, daemonStop, daemonRestart, daemonStatus } from "../lib/api";

export function useDaemonStatus() {
  return useQuery({
    queryKey: ["daemon", "status"],
    queryFn: daemonStatus,
    refetchInterval: 5000,
    retry: 2,
  });
}

export function useDaemonStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: daemonStart,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["daemon", "status"] }),
  });
}

export function useDaemonStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: daemonStop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["daemon", "status"] }),
  });
}

export function useDaemonRestart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: daemonRestart,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["daemon", "status"] }),
  });
}
