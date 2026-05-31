import { useQuery } from "@tanstack/react-query";
import { systemStatus } from "../lib/api";

export function useSystemStatus() {
  return useQuery({
    queryKey: ["system", "status"],
    queryFn: systemStatus,
    refetchInterval: 10000,
  });
}
