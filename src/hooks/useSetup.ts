import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  principalSetupRun,
  principalSetupStatus,
  principalStopSetup,
  type RuntimeId,
  type SetupStatus,
} from "../lib/api";

/** Whether the peko is on its first turn or going through its setup steps. */
export function isSettingUp(status: SetupStatus | null | undefined): boolean {
  return !!status && (status.settingUp || status.setupState === "running");
}

// A peko's first turn: what it has done so far, and stopping it.

const DEFAULT_RUNTIME_ID = "local";
/** Poll cadence while a peko is on its first turn. */
const SETUP_POLL_INTERVAL_MS = 2_000;

/**
 * How a local peko's first turn is going. Polls while it is setting
 * itself up or doing something on its own; a peko that is set up is
 * asked once.
 */
export function useSetupStatus(name: string | undefined, runtimeId?: RuntimeId) {
  const rid = runtimeId ?? DEFAULT_RUNTIME_ID;
  return useQuery({
    queryKey: ["setupStatus", rid, name],
    queryFn: () => principalSetupStatus(name as string, rid),
    enabled: !!name && rid === DEFAULT_RUNTIME_ID,
    staleTime: SETUP_POLL_INTERVAL_MS,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      const status = query.state.data;
      return isSettingUp(status) || status?.running ? SETUP_POLL_INTERVAL_MS : false;
    },
  });
}

/** Stop what a peko is doing on its own, then re-read its status. */
export function useStopSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { name: string; runtimeId?: RuntimeId }) =>
      principalStopSetup(req.name, req.runtimeId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["setupStatus"] });
      void qc.invalidateQueries({ queryKey: ["principals"] });
    },
  });
}

/** Have a peko go through its setup steps again, then re-read its status. */
export function useRunSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { name: string; runtimeId?: RuntimeId }) =>
      principalSetupRun(req.name, req.runtimeId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["setupStatus"] });
    },
  });
}
