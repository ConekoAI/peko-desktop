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

function CapabilityToggle({
  capability,
  granted,
  coveredBy,
  pending,
  onGrant,
  onRevoke,
}: {
  capability: string;
  granted: boolean;
  coveredBy?: string;
  pending?: boolean;
  onGrant?: () => void;
  onRevoke?: () => void;
}) {
  if (granted || coveredBy) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
        title={coveredBy ? `Covered by ${coveredBy}` : undefined}
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        <Check className="h-3 w-3" />
        {capability}
        {onRevoke && !coveredBy && (
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
}: {
  ext: ExtensionSummary;
  principalName: string;
  granted: string[];
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
            const grantedState = isGranted(granted, cap);
            const covered = coveringWildcard(granted, cap);
            const pending =
              (grant.isPending && grant.variables?.capability === cap) ||
              (revoke.isPending && revoke.variables?.capability === cap);
            return (
              <CapabilityToggle
                key={cap}
                capability={cap}
                granted={grantedState}
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

  const extensionCapSet = new Set(
    (extensions ?? []).flatMap((ext) => ext.provides),
  );
  const otherCaps = Array.from(
    new Set([...granted, ...detected]),
  ).filter((cap) => !extensionCapSet.has(cap));

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
          Enable or disable capabilities for this principal. Each extension is a
          bundle of capabilities; you can grant or revoke the whole bundle or
          toggle individual capabilities.
        </p>
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
          <div className="space-y-3">
            {(extensions ?? []).map((ext) =>
              ext.provides.length > 0 ? (
                <ExtensionCard
                  key={ext.id}
                  ext={ext}
                  principalName={principalName}
                  granted={granted}
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
                  const grantedState = isGranted(granted, cap);
                  const covered = coveringWildcard(granted, cap);
                  const pending =
                    (grant.isPending && grant.variables?.capability === cap) ||
                    (revoke.isPending && revoke.variables?.capability === cap);
                  return (
                    <CapabilityToggle
                      key={cap}
                      capability={cap}
                      granted={grantedState}
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
