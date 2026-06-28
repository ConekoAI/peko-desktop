import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";

export interface PrincipalSummary {
  name: string;
  exposure: string;
  status: string;
  description?: string;
  runtimeId: string;
}

export function usePrincipals() {
  return useQuery({
    queryKey: ["principals", "local"],
    queryFn: () => invoke<PrincipalSummary[]>("principal_list"),
  });
}

export function usePrincipal(name: string | undefined) {
  return useQuery({
    queryKey: ["principals", "local", name],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      // Principal detail is a subset of the list today; fetch the list
      // and filter. A dedicated `principal_show` IPC variant will be
      // added in a follow-up PR.
      return invoke<PrincipalSummary[]>("principal_list").then((all) =>
        all.find((p) => p.name === name) ?? null,
      );
    },
    enabled: !!name,
  });
}

export interface PrincipalSendOptions {
  onChunk?: (delta: string) => void;
}

/**
 * Send a message to a principal. Returns the supervisor's final
 * response as a string.
 *
 * If `onChunk` is provided, the supervisor's streaming deltas are
 * pushed through the callback as the response unfolds. The `Channel`
 * wire type is required by Tauri's IPC layer for streaming.
 */
export function usePrincipalSend() {
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      message: string;
      onChunk?: (delta: string) => void;
    }): Promise<string> => {
      if (!vars.onChunk) {
        return invoke<string>("principal_send", {
          name: vars.name,
          message: vars.message,
        });
      }
      const channel = new Channel<string>();
      channel.onmessage = vars.onChunk;
      return invoke<string>("principal_send_stream", {
        app: undefined,
        name: vars.name,
        message: vars.message,
        onChunk: channel,
      });
    },
  });
}
