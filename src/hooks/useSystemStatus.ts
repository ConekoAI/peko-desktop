import { useQuery } from "@tanstack/react-query";
import { systemStatus } from "../lib/api";

export function useSystemStatus(runtimeId?: string) {
  return useQuery({
    queryKey: ["system", "status", runtimeId ?? "local"],
    queryFn: () => systemStatus(runtimeId),
    refetchInterval: 10000,
  });
}
