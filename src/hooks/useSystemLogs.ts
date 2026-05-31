import { useQuery } from "@tanstack/react-query";
import { systemLogs } from "../lib/api";

export function useSystemLogs(lines?: number) {
  return useQuery({
    queryKey: ["system", "logs", lines],
    queryFn: () => systemLogs(lines),
    refetchInterval: 5000,
  });
}
