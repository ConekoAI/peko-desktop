import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  useCapabilities,
  useGrantCapability,
  useRevokeCapability,
} from "../hooks/useCapabilities";
import { useExtensions } from "../hooks/useExtensions";
import {
  ArrowLeft,
  Plus,
  X,
  Loader2,
  Shield,
  AlertCircle,
  Check,
} from "lucide-react";
import type { ExtensionSummary } from "../types";

function isGranted(grants: string[], cap: string): boolean {
  return grants.some(
    (g) => g === cap || (g.endsWith("*") && cap.startsWith(g.slice(0, -1))),
  );
}

function coveringWildcard(
  grants: string[],
  cap: string,
): string | undefined {
  return grants.find(
    (g) => g !== cap && g.endsWith("*") && cap.startsWith(g.slice(0, -1)),
  );
}

type CapabilityState = "active" | "granted-inactive" | "covered" | "missing";

function capabilityState(
  cap: string,
  activeSet: Set<string>,
  granted: string[],
): CapabilityState {
  if (activeSet.has(cap)) return "active";
  const wild = coveringWildcard(granted, cap);
  if (wild) return "covered";
  if (granted.includes(cap)) return "granted-inactive";
  return "missing";
}

function CapabilityToggle({
  capability,
  state,
  coveredBy,
  pending,
  onGrant,
  onRevoke,
}: {
  capability: string;
  state: CapabilityState;
  coveredBy?: string;
  pending?: boolean;
  onGrant?: () => void;
  onRevoke?: () => void;
}) {
  if (state === "active") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
        title="Granted and currently usable"
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        <Check className="h-3 w-3" />
        {capability}
        {onRevoke && (
          <button
            onClick={onRevoke}
            disabled={pending}
            className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100 disabled:opacity-50 dark:hover:bg-emerald-900/50"
            title="Revoke"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  if (state === "granted-inactive") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        title="Granted, but the extension is not active"
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        <AlertCircle className="h-3 w-3" />
        {capability}
        {onRevoke && (
          <button
            onClick={onRevoke}
            disabled={pending}
            className="ml-0.5 rounded-full p-0.5 hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/50"
            title="Revoke"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  if (state === "covered") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
        title={coveredBy ? `Covered by ${coveredBy}` : "Covered by a wildcard grant"}
      >
        <Check className="h-3 w-3" />
        {capability}
      </span>
    );
  }

  return (
    <button
      onClick={onGrant}
      disabled={pending || !onGrant}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      <Plus className="h-3 w-3" />
      {capability}
    </button>
  );
}

function ExtensionCard({
  ext,
  principalName,
  granted,
  activeSet,
}: {
  ext: ExtensionSummary;
  principalName: string;
  granted: string[];
  activeSet: Set<string>;
}) {
  const grant = useGrantCapability();
  const revoke = useRevokeCapability();
  const caps = ext.provides;

  async function toggle(cap: string) {
    if (granted.includes(cap)) {
      await revoke.mutateAsync({ principal: principalName, capability: cap });
      return;
    }
    if (coveringWildcard(granted, cap)) {
      return;
    }
    await grant.mutateAsync({ principal: principalName, capability: cap });
  }

  async function grantAll() {
    const toGrant = caps.filter(
      (cap) => !isGranted(granted, cap) && !coveringWildcard(granted, cap),
    );
    await Promise.all(
      toGrant.map((cap) =>
        grant.mutateAsync({ principal: principalName, capability: cap }),
      ),
    );
  }

  async function revokeAll() {
    const toRevoke = caps.filter((cap) => granted.includes(cap));
    await Promise.all(
      toRevoke.map((cap) =>
        revoke.mutateAsync({ principal: principalName, capability: cap }),
      ),
    );
  }

  const allGranted =
    caps.length > 0 && caps.every((cap) => isGranted(granted, cap));
  const anyGranted = caps.some((cap) => isGranted(granted, cap));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {ext.name}
            </h3>
            <span
              className={[
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                ext.source === "built-in"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
              ].join(" ")}
            >
              {ext.source}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {ext.extType}
            </span>
          </div>
          {ext.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {ext.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => grantAll()}
            disabled={grant.isPending || allGranted || caps.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {grant.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            <Plus className="h-3 w-3" />
            Grant all
          </button>
          <button
            onClick={() => revokeAll()}
            disabled={revoke.isPending || !anyGranted}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {revoke.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            <X className="h-3 w-3" />
            Revoke all
          </button>
        </div>
      </div>

      {caps.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This extension does not declare any capabilities.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {caps.map((cap) => {
            const state = capabilityState(cap, activeSet, granted);
            const covered = coveringWildcard(granted, cap);
            const pending =
              (grant.isPending && grant.variables?.capability === cap) ||
              (revoke.isPending && revoke.variables?.capability === cap);
            return (
              <CapabilityToggle
                key={cap}
                capability={cap}
                state={state}
                coveredBy={covered}
                pending={pending}
                onGrant={() => toggle(cap)}
                onRevoke={() => toggle(cap)}
              />
            );
          })}
        </div>
      )}

      {ext.requires.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Requires:</span>
          {ext.requires.map((req) => (
            <span
              key={req}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
            >
              {req}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PrincipalCapabilities() {
  const params = useParams({ strict: false }) as { principalName?: string };
  const principalName = params.principalName;
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCapabilities(principalName);
  const { data: extensions, isLoading: extensionsLoading } = useExtensions();
  const grant = useGrantCapability();
  const revoke = useRevokeCapability();
  const [custom, setCustom] = useState("");

  function handleGrant(capability: string) {
    if (!principalName || !capability.trim()) return;
    grant.mutate({ principal: principalName, capability: capability.trim() });
  }

  function handleRevoke(capability: string) {
    if (!principalName) return;
    revoke.mutate({ principal: principalName, capability });
  }

  function handleAddCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!custom.trim()) return;
    handleGrant(custom.trim());
    setCustom("");
  }

  const granted = data?.granted ?? [];
  const detected = data?.detected ?? [];
  const active = data?.active ?? [];
  const activeSet = new Set(active);
  // Runtime-sourced "currently authoritative" enabled-extension set
  // (ExtensionCatalog::active_extensions()). Falls back to an empty set
  // for older daemon builds that don't populate the field. `useExtensions()`
  // is still used below for per-extension metadata (`provides`,
  // `description`, etc.) — that data isn't on the capability payload.
  const runtimeActiveExtensions = data?.activeExtensions ?? [];

  const extensionCapSet = new Set(
    (extensions ?? []).flatMap((ext) => ext.provides),
  );
  const otherCaps = Array.from(
    new Set([...granted, ...detected]),
  ).filter((cap) => !extensionCapSet.has(cap));

  // Companion to the runtime fix in peko-runtime PR #216: the system prompt
  // now hides tool entries the principal doesn't have granted, so revoking
  // every `tool:*` grant silently leaves the agent without callable tools.
  // Surface the broken state here so the operator understands the chat will
  // fail with `tool not available`/`<tool_call>` raw text symptoms rather
  // than having to discover the cause from log scraping.
  const toolCapsOffered = Array.from(extensionCapSet).filter((cap) =>
    cap.toLowerCase().startsWith("tool:"),
  );
  const toolCapsGranted = granted.filter((cap) =>
    cap.toLowerCase().startsWith("tool:"),
  );
  const isWildcardToolGrant = (cap: string) =>
    cap.toLowerCase().endsWith("*") &&
    cap.toLowerCase().startsWith("tool") &&
    cap.length > "tool".length;
  const hasToolWildcard = granted.some(isWildcardToolGrant);
  const toolsRevoked = toolCapsOffered.length > 0 && toolCapsGranted.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            navigate({
              to: "/chat/$principalName",
              params: { principalName: principalName ?? "" },
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </button>
      </div>

      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
          <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          {principalName ? principalName : "Principal"} capabilities
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Grant or revoke capabilities for this principal. Green = active and
          usable; amber = granted but the extension is not active; blue = covered
          by a wildcard grant.
        </p>
        {runtimeActiveExtensions.length > 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {runtimeActiveExtensions.length} extension
            {runtimeActiveExtensions.length === 1 ? "" : "s"} currently active
            per the runtime.
          </p>
        )}
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">
            {error?.message ?? "Failed to load capabilities"}
          </span>
        </div>
      )}

      {(isLoading || extensionsLoading) && (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading capabilities…
        </div>
      )}

      {!isLoading && !extensionsLoading && principalName && (
        <>
          {toolsRevoked && !hasToolWildcard && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-sm">
                <div className="font-medium">All tool capabilities revoked</div>
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  The principal has every <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">tool:*</code> grant revoked.
                  The agent will respond without any callable tools and may emit
                  raw <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">&lt;tool_call&gt;</code>{" "}
                  tags that fail to invoke. Grant at least{" "}
                  <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">tool:*</code>{" "}
                  or the specific tools the principal needs.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {(extensions ?? []).map((ext) =>
              ext.provides.length > 0 ? (
                <ExtensionCard
                  key={ext.id}
                  ext={ext}
                  principalName={principalName}
                  granted={granted}
                  activeSet={activeSet}
                />
              ) : null,
            )}
          </div>

          {otherCaps.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                Other capabilities
              </h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Grants not tied to a declared extension bundle, such as wildcard
                agent authority or manually-added capabilities.
              </p>
              <div className="flex flex-wrap gap-2">
                {otherCaps.map((cap) => {
                  const state = capabilityState(cap, activeSet, granted);
                  const covered = coveringWildcard(granted, cap);
                  const pending =
                    (grant.isPending && grant.variables?.capability === cap) ||
                    (revoke.isPending && revoke.variables?.capability === cap);
                  return (
                    <CapabilityToggle
                      key={cap}
                      capability={cap}
                      state={state}
                      coveredBy={covered}
                      pending={pending}
                      onGrant={() => handleGrant(cap)}
                      onRevoke={() => handleRevoke(cap)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <form
        onSubmit={handleAddCustom}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          Add custom capability
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. tool:Write or agent:researcher"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={grant.isPending || !custom.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {grant.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Grant
          </button>
        </div>
      </form>
    </div>
  );
}
