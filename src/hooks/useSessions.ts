import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  sessionList,
  sessionShow,
  sessionHistory,
  sessionCreate,
  sessionBranch,
  sessionCompact,
} from "../lib/api";

export function useSessions(agent?: string) {
  return useQuery({
    queryKey: ["sessions", agent ?? "all"],
    queryFn: () => sessionList(agent),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ["sessions", id],
    queryFn: () => sessionShow(id),
    enabled: !!id,
  });
}

export function useSessionHistory(id: string) {
  return useQuery({
    queryKey: ["sessions", id, "history"],
    queryFn: () => sessionHistory(id),
    enabled: !!id,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof sessionCreate>[0]) => sessionCreate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useBranchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, messageId }: { sessionId: string; messageId: string }) =>
      sessionBranch(sessionId, messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useCompactSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => sessionCompact(sessionId),
    onSuccess: (_data, sessionId) => {
      qc.invalidateQueries({ queryKey: ["sessions", sessionId] });
    },
  });
}
