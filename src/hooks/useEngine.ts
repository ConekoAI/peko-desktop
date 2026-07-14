import {
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  engineStatus,
  engineDiagnostics,
  engineRestart,
} from "../lib/api";
import type {
  EngineState,
  EngineVersionMismatch,
} from "../types";

// ─── Polling hooks ───────────────────────────────────────────────

/**
 * Poll `engine_status` on a tight cadence. The supervisor holds the
 * snapshot in `Arc<Mutex<Inner>>` so the command is cheap (a Mutex
 * snapshot, no IPC round-trip), which is why we can poll this fast.
 *
 * Pair with the `engine-state-changed` listener for sub-cadence
 * updates — the supervisor emits that event every time the state
 * changes (Starting → Running, Restarting → Failed, etc.), so the
 * UI doesn't have to wait for the next poll to reflect a transition.
 */
export function useEngineStatus() {
  return useQuery<EngineState>({
    queryKey: ["engine", "status"],
    queryFn: engineStatus,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

/**
 * Snapshot for the diagnostics panel. Kept on a `queryFn` so
 * refreshes are visible in React Query DevTools; expensive enough
 * (clones the log ring buffer) that we should not poll it.
 *
 * `refetch` is the imperative handle used by the "Refresh" button
 * in the diagnostics toggle.
 */
export function useEngineDiagnostics() {
  return useQuery({
    queryKey: ["engine", "diagnostics"],
    queryFn: engineDiagnostics,
    // Default to disabled; the diagnostics panel only needs the
    // snapshot when the user has opened it. The panel calls
    // `refetch()` after every state-change event.
    enabled: false,
    staleTime: 0,
  });
}

/**
 * Manual restart. The supervisor normally auto-restarts once on
 * unexpected exit; this hook is for the diagnostics panel where a
 * developer/support agent wants to recover from `Failed`.
 */
export function useEngineRestart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: engineRestart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
  });
}

// ─── Event subscriptions ─────────────────────────────────────────

/**
 * Subscribe to `engine-state-changed`. The supervisor emits this
 * whenever the EngineState transitions (Starting → Running on first
 * stderr line, Restarting on exit, Failed when give-up fires). The
 * payload mirrors the EngineState enum from `engine_status`.
 *
 * Returns the latest state seen via the event channel, plus a
 * `lastEventAt` timestamp; the query layer remains the source of
 * truth for snapshot reads (this hook is for transition flash).
 */
export function useEngineStateChanged(): {
  state: EngineState | null;
  lastEventAt: number | null;
} {
  const [state, setState] = useState<EngineState | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<EngineState>("engine-state-changed", (event) => {
      if (cancelled) return;
      setState(event.payload);
      setLastEventAt(Date.now());
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return { state, lastEventAt };
}

/**
 * Subscribe to `engine-version-mismatch`. The supervisor emits this
 * when the bundled engine's version does not match the version the
 * desktop was built against (expected to be the same in lockstep
 * releases, but worth surfacing if they diverge).
 *
 * Returns the most recent mismatch payload (or null) and a
 * dismiss callback. The dashboard banner is the only consumer; it
 * clears the dismissal once the engine reports a matching version
 * (or restarts).
 */
export function useEngineVersionMismatch(): {
  mismatch: EngineVersionMismatch | null;
  lastEventAt: number | null;
  dismiss: () => void;
} {
  const [mismatch, setMismatch] = useState<EngineVersionMismatch | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const dismiss = useCallback(() => {
    setMismatch(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<EngineVersionMismatch>(
      "engine-version-mismatch",
      (event) => {
        if (cancelled) return;
        setMismatch(event.payload);
        setLastEventAt(Date.now());
      },
    ).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return { mismatch, lastEventAt, dismiss };
}
