import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  principalApprovals,
  principalCreate,
  principalDecideApproval,
  principalExport,
  principalGet,
  principalImport,
  principalImportPreview,
  principalList,
  principalLog,
  principalRemove,
  principalSend,
  principalSendStream,
  principalLogWatch,
  principalUpdate,
  type ChatStreamMsg,
  type PrincipalCreateRequest,
  type PrincipalSummary,
  type PrincipalUpdateRequest,
  type RuntimeId,
} from "../lib/api";

export type { PrincipalSummary };

const DEFAULT_RUNTIME_ID = "local";

/** PR #3: tiny helper that normalizes `RuntimeId` to `"local"`. */
function effectiveRuntimeId(runtimeId?: RuntimeId): string {
  return runtimeId ?? DEFAULT_RUNTIME_ID;
}

// ─── Genesis / boot_state (ADR-054) ──────────────────────────────
//
// `peko create` now runs a genesis boot sequence, so a freshly
// created principal can appear on `principal_list` /
// `principal_get` with `bootState: "genesis_pending"` (or earlier)
// before it is ready to chat. The hooks below expose `bootState`
// verbatim (it rides along on `PrincipalSummary`) and keep polling
// until the principal reaches `organized`.

/**
 * True when the summary carries a `bootState` that is not yet
 * `organized`. Runtimes older than the genesis pipeline omit the
 * field entirely — those principals count as already organized.
 */
export function isGenesisPending(
  p: Pick<PrincipalSummary, "bootState"> | null | undefined,
): boolean {
  return !!p?.bootState && p.bootState !== "organized";
}

/** Poll cadence while any principal is mid-genesis. */
const GENESIS_POLL_INTERVAL_MS = 2_000;
/**
 * Hard cap on post-create genesis polling. Matches the runtime's
 * default genesis wait (~300s); if genesis hasn't finished by then
 * something is wrong runtime-side and the list falls back to its
 * normal refresh cadence.
 */
const GENESIS_POLL_TIMEOUT_MS = 300_000;

// ─── Principal list / detail ─────────────────────────────────────

export function usePrincipals(runtimeId?: RuntimeId) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    // PR #3: query key now varies by runtimeId so the React Query
    // cache routes correctly across local + remote principals.
    queryKey: ["principals", rid],
    queryFn: () => principalList(rid),
    // The runtime list call is ~5 ms via CLI, but the desktop path goes
    // through Tauri -> IPC ensure_daemon probe -> daemon roundtrip, so
    // each fetch is tens-to-hundreds of milliseconds. Keep the list fresh
    // enough without re-running that path on every mount or window focus.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: (query) => {
      // Genesis (ADR-054): while any principal reports a non-organized
      // bootState, poll fast so the sidebar / create flow can render
      // live boot progress. Pauses when the tab is hidden; returns to
      // the normal cadence once every row is organized (or the field
      // is absent on older runtimes).
      if (typeof document !== "undefined" && document.hidden) return false;
      const rows = query.state.data;
      return Array.isArray(rows) && rows.some(isGenesisPending)
        ? GENESIS_POLL_INTERVAL_MS
        : false;
    },
  });
}

export function usePrincipal(name: string | undefined, runtimeId?: RuntimeId) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    queryKey: ["principals", rid, name],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalGet(name, rid);
    },
    enabled: !!name,
  });
}

// ─── Principal create (T-105) ───────────────────────────────────

/**
 * Detached post-create boot_state watcher. When `principal_create`
 * returns before genesis completes (the summary still says
 * `genesis_pending` or earlier), keep polling `principal_get` and
 * refreshing the list/detail caches until the principal reaches
 * `organized` — or the ~300s cap hits, matching the runtime's
 * genesis wait. Runs detached so the mutation settles as soon as the
 * runtime answers; the UI renders progress from `bootState` on the
 * list query in the meantime.
 */
async function pollBootStateUntilOrganized(
  qc: QueryClient,
  name: string,
  rid: string,
): Promise<void> {
  const deadline = Date.now() + GENESIS_POLL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, GENESIS_POLL_INTERVAL_MS));
      const current = await principalGet(name, rid).catch(() => null);
      if (!isGenesisPending(current)) break;
      void qc.invalidateQueries({ queryKey: ["principals"] });
    }
  } finally {
    void qc.invalidateQueries({ queryKey: ["principals"] });
    void qc.invalidateQueries({ queryKey: ["principals", rid, name] });
  }
}

/**
 * Create a new Principal on the local runtime. Invalidates the
 * `["principals"]` query so the sidebar / Chat principal picker
 * pick up the new entry without a manual refresh. Errors (name
 * validation, AlreadyExists, daemon unreachable) propagate to the
 * caller; the modal/walkthrough surfaces them inline.
 *
 * Genesis-aware (ADR-054): the runtime may block inside
 * `principal_create` for the length of the genesis boot (its wait
 * caps at ~300s — the backend extends the IPC request timeout to
 * match), or return early with `bootState: "genesis_pending"`. In
 * the early-return case this hook keeps the list/detail caches
 * refreshing until the principal reports `organized` (capped), so
 * UI progress states driven by `bootState` resolve on their own.
 */
export function usePrincipalCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PrincipalCreateRequest) => principalCreate(req),
    onSuccess: (created, vars) => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      // Listed at once, so the chat that opens next finds it.
      qc.setQueryData<PrincipalSummary[]>(["principals", rid], (list) =>
        list && !list.some((p) => p.name === created.name) ? [...list, created] : list,
      );
      void qc.invalidateQueries({ queryKey: ["principals"] });
      if (isGenesisPending(created)) {
        void pollBootStateUntilOrganized(qc, created.name, rid);
      }
    },
  });
}

/**
 * Update an existing Principal's mutable config. Invalidates both
 * the principal list and the detail query so all surfaces reflect
 * the change immediately.
 */
export function usePrincipalUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PrincipalUpdateRequest) => principalUpdate(req),
    onSuccess: (_data, vars) => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      qc.invalidateQueries({ queryKey: ["principals"] });
      qc.invalidateQueries({ queryKey: ["principals", rid, vars.name] });
    },
  });
}

/**
 * Remove a Principal and its on-disk workspace. Invalidates the
 * principal list; callers should navigate away from any route that
 * references the removed principal.
 */
export function usePrincipalRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; runtimeId?: RuntimeId }) =>
      principalRemove(vars.name, vars.runtimeId),
    onSuccess: (_data, vars) => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      // Gone at once: no view may fall back to it, and a new peko of
      // the same name starts with an empty thread.
      qc.setQueryData<PrincipalSummary[]>(["principals", rid], (list) =>
        list?.filter((p) => p.name !== vars.name),
      );
      qc.removeQueries({ queryKey: ["principals", rid, vars.name] });
      qc.removeQueries({ queryKey: ["principal-log", rid, vars.name] });
      void qc.invalidateQueries({ queryKey: ["principals"] });
    },
  });
}

// ─── `.peko` package export / import (ADR-056) ───────────────────

/**
 * Export a principal's full existence (workspace, memory, private
 * keys) to a `.peko` package at `output`. No cache invalidation —
 * export doesn't change runtime state. The UI must surface the
 * key-sensitivity warning before calling this.
 */
export function usePrincipalExport() {
  return useMutation({
    mutationFn: (args: { name: string; output: string }) =>
      principalExport(args),
  });
}

/**
 * Wake a principal from a `.peko` package at `path`. The Tauri
 * command follows a successful import with `principal_reload`
 * itself, so on success the peko is live daemon-side and only the
 * list cache needs refreshing. Runtime errors propagate verbatim —
 * keyless packages reject with the "ground it with `peko create`"
 * guidance, which the UI renders as-is.
 */
/** Preview a `.peko` package before importing it. */
export function usePrincipalImportPreview() {
  return useMutation({
    mutationFn: (args: { path: string; rotateKeys?: boolean }) => principalImportPreview(args),
  });
}

export function usePrincipalImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { path: string; manifestChecksum: string; rotateKeys?: boolean }) =>
      principalImport(args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["principals"] });
    },
  });
}

// ─── Caller identity (for the ADR-042 privacy gate) ─────────────

/**
 * Best-effort caller identity for the desktop.
 *
 * The desktop reads the active runtime's "local user" from the runtime
 * via `principal_list` (the `owner` field on each principal that the
 * local user owns). For a multi-user install the caller is the
 * `user:<hub-user-id>` Subject that was used to log into PekoHub; for
 * a single-user install the runtime exposes a single local DID. This
 * hook returns the Subject string the privacy-gate UI passes to
 * `principal_log` when the caller is not the principal's owner.
 */
export function useCallerSubject(): string {
  // Caller identity is always local — the dot keystore / vault key
  // identity is the desktop user's own. Remote principals live in
  // pekohub's identity space; their `owner` field comes back as a
  // pekohub user id, not this desktop's identity.
  const { data: principals } = usePrincipals();
  if (!principals || principals.length === 0) return "user:local";
  // Pick any owned principal — every owned principal shares an owner.
  const owned = principals.find((p) => p.owner && p.owner !== "");
  return owned?.owner || "user:local";
}

// ─── Principal send (chat) ──────────────────────────────────────

export interface PrincipalSendOptions {
  onEvent?: (msg: ChatStreamMsg) => void;
}

/**
 * Monotonically increasing `requestId` source for streaming sends.
 *
 * Caps at `2^62 - 1` then wraps to 1 so the desktop's namespace
 * stays disjoint from the runtime's steering-successor ids (`2^63`+). Without the cap a long-lived desktop session could
 * drift into the runtime's namespace after ~292 years of continuous
 * use — the cap also documents the invariant so future readers don't
 * "fix" the wrap by switching the modulo.
 */
let nextRequestIdCounter = 1;
const REQUEST_ID_CAP = (1n << 62n) - 1n;
function nextRequestId(): number {
  const cur = nextRequestIdCounter++;
  if (BigInt(cur) >= REQUEST_ID_CAP) {
    nextRequestIdCounter = 2;
    return 1;
  }
  return cur;
}

/**
 * Send a message to a principal. Returns the supervisor's final
 * response as a string.
 *
 * If `onEvent` is provided, the supervisor's streaming events
 * (chunk deltas and agentic-iteration boundary markers) are pushed
 * through the callback as the response unfolds. The `Channel` wire
 * type is required by Tauri's IPC layer for streaming.
 *
 * Sending while a run is in flight is safe: the runtime queues the
 * message for the running turn and the stream settles with a
 * `queued` event and empty content.
 */
export function usePrincipalSend() {
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      message: string;
      onEvent?: (msg: ChatStreamMsg) => void;
      runtimeId?: RuntimeId;
      /** A configured model id for this message only. */
      overrideModel?: string;
      /** Absolute paths of files to attach (local pekos only). */
      attachments?: string[];
    }): Promise<string> => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      if (!vars.onEvent) {
        return principalSend(vars.name, vars.message, rid);
      }
      const result = await principalSendStream(
        vars.name,
        vars.message,
        nextRequestId(),
        vars.onEvent,
        rid,
        vars.overrideModel,
        vars.attachments,
      );
      return result.content;
    },
  });
}

/**
 * The approval requests waiting for a local peko's owner (runtime
 * ADR-078). Refetched when the peko's thread changes (its notice lands
 * there) and every 30 s, so a request filed elsewhere shows up too.
 */
export function usePrincipalApprovals(name: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["approvals", name],
    queryFn: () => principalApprovals(name!),
    enabled: !!name && enabled,
    refetchInterval: 30_000,
  });
}

/** Approve or deny a waiting request; the list refreshes after. */
export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: principalDecideApproval,
    onSettled: (_data, _err, vars) => qc.invalidateQueries({ queryKey: ["approvals", vars.name] }),
  });
}

/**
 * Follow the caller's thread with `name` live and refetch the
 * `principal-log` query whenever a new DM row lands — replies to
 * queued messages, cron and check-in posts, approval requests, and
 * stop markers all arrive this way. While `pausedRef.current` is true
 * (a stream is rendering the reply itself) refetches are skipped; the
 * caller calls `flush` when the stream settles. Local runtime only;
 * remote pekos have no watch API.
 *
 * `sinceCursor` is the newest row the caller has already loaded (see
 * `newestLogCursor`); `undefined` means the thread hasn't loaded yet,
 * and the watch waits for it so opening a chat never replays history.
 * It is read once per subscription.
 */
export function usePrincipalLogWatch(
  name: string | undefined,
  peer: string | undefined,
  runtimeId: RuntimeId | undefined,
  sinceCursor: string | null | undefined,
) {
  const qc = useQueryClient();
  const rid = effectiveRuntimeId(runtimeId);
  const pausedRef = useRef(false);
  const queryKey = ["principal-log", rid, name, peer ?? "owner"];
  const ready = sinceCursor !== undefined;
  const sinceRef = useRef(sinceCursor);
  sinceRef.current = sinceCursor;

  useEffect(() => {
    if (!name || rid !== DEFAULT_RUNTIME_ID || !ready) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    principalLogWatch(name, peer, sinceRef.current ?? null, () => {
      if (pausedRef.current) return;
      void qc.invalidateQueries({ queryKey: ["principal-log", rid, name, peer ?? "owner"] });
    })
      .then((unwatch) => {
        if (cancelled) unwatch();
        else stop = unwatch;
      })
      .catch(() => {
        // No watch (daemon down or older runtime): the log still
        // refreshes after every send.
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [name, peer, rid, qc, ready]);

  return {
    pausedRef,
    /** Refetch the thread now (rows that landed while paused included). */
    flush: () => qc.refetchQueries({ queryKey }),
  };
}

/**
 * The newest row number in a loaded thread page, as a log-watch
 * cursor. Log row ids are `chan_<line>`; `null` for an empty thread.
 */
export function newestLogCursor(messages: { id: string }[] | undefined): string | null {
  let newest: number | null = null;
  for (const m of messages ?? []) {
    const line = Number(m.id.startsWith("chan_") ? m.id.slice(5) : NaN);
    if (Number.isInteger(line)) newest = newest === null ? line : Math.max(newest, line);
  }
  return newest === null ? null : String(newest);
}

// ─── Principal log (peko log, ADR-042) ──────────────────────────

/**
 * Read a peer's conversation thread with a Principal. Pass `peer =
 * undefined` for the principal's owner-root view (default
 * `peko log <PRINCIPAL>`); pass `peer = "user:<self>"` for peer
 * self-read. The runtime enforces the privacy contract.
 *
 * Returns the latest `limit` (default 100) messages plus paging
 * state. Callers that need older messages should use
 * `fetchOlderPrincipalLog` to walk pages without overlap or gaps.
 */
export function usePrincipalLog(
  name: string | undefined,
  peer: string | undefined,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    queryKey: ["principal-log", rid, name, peer ?? "owner"],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalLog({ name, peer, limit: 100, runtimeId: rid });
    },
    enabled: !!name,
    // A run waiting out a disruption continues on its own; look again
    // now and then so its status (and its reply) show up.
    refetchInterval: (query) => (query.state.data?.runFailure?.nextAttemptAt ? 20_000 : false),
  });
}

/**
 * Manually fetch the next older page of chat-log messages for a
 * principal / peer pair. Returns the raw page envelope so callers
 * can reconcile (e.g. by message id) against their in-memory
 * history. Throws on daemon errors; the caller should treat the
 * thrown error as "stop paging".
 */
export async function fetchOlderPrincipalLog(params: {
  name: string;
  peer?: string;
  limit?: number;
  cursor: string;
  runtimeId?: RuntimeId;
}) {
  return principalLog({
    name: params.name,
    peer: params.peer,
    limit: params.limit ?? 100,
    cursor: params.cursor,
    runtimeId: params.runtimeId,
  });
}
