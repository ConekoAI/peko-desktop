import { useMutation, useQueryClient } from "@tanstack/react-query";

import { channelPost, type RuntimeId } from "../lib/api";

// ─── Mutation: post a message to a channel ───────────────────────
//
// On success: invalidate `["channel-events", channelId]` so the
// composer-side optimistic UI gets replaced with the server's view,
// and `["channels", rid]` so the sidebar's member-count hint refreshes.
// On error: surface the message string via `error`; callers (the
// composer) render an inline error chip and re-enable the input.
//
// Mirrors `usePrincipalUpdate` shape at `usePrincipals.ts:71-112`:
// mutation returns `{ task_id }` from the runtime, but the frontend
// doesn't need it today — keep the variable available for PR-2b's
// correlation-id flow (`prin_principal_sent_iteration` pattern at
// `desktop-iteration-bubble-boundary.md`).

export interface UseChannelPostArgs {
  channelId: string;
  senderName: string;
  text: string;
  parent?: string | null;
  runtimeId?: RuntimeId;
}

export function useChannelPost(runtimeId?: RuntimeId) {
  const qc = useQueryClient();

  return useMutation<string, Error, UseChannelPostArgs>({
    mutationFn: ({ channelId, senderName, text, parent }) =>
      channelPost(channelId, senderName, text, parent, runtimeId),
    onSuccess: (_taskId, vars) => {
      void qc.invalidateQueries({
        queryKey: ["channel-events", runtimeId ?? "local", vars.channelId],
      });
      void qc.invalidateQueries({
        queryKey: ["channel", runtimeId ?? "local", vars.channelId],
      });
      void qc.invalidateQueries({
        queryKey: ["channels", runtimeId ?? "local"],
      });
    },
  });
}