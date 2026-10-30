import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";

import { principalSetLimits, principalUsage } from "../../lib/api";
import type { UsageCycle, UsageLimits } from "../../types";

const PERIOD: Record<UsageCycle, string> = {
  hourly: "This hour",
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
};

const PER: Record<UsageCycle, string> = {
  hourly: "per hour",
  daily: "per day",
  weekly: "per week",
  monthly: "per month",
};

/** `$0.09`, or more places for small amounts (`$0.0042`). */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** `81.7K` tokens. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * What a local peko has used this cycle and what it may spend. Spend is
 * counted for models with a price (Settings → Models); once a cycle's
 * spend reaches the budget, the peko makes no more model calls until
 * the cycle resets.
 */
export default function UsagePanel({
  name,
  priced,
}: {
  name: string;
  /** Whether the peko's model has a price, so spend is counted. */
  priced: boolean;
}) {
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: ["principal-usage", name],
    queryFn: () => principalUsage(name),
    refetchInterval: 15_000,
  });
  const save = useMutation({
    mutationFn: (config: UsageLimits) => principalSetLimits(name, config),
    onSuccess: (next) => queryClient.setQueryData(["principal-usage", name], next),
  });
  const [budget, setBudget] = useState("");
  const [cycle, setCycle] = useState<UsageCycle>("daily");

  const config = usage.data?.config;
  useEffect(() => {
    if (!config) return;
    setBudget(config.budget_per_cycle != null ? String(config.budget_per_cycle) : "");
    setCycle(config.cycle);
  }, [config?.budget_per_cycle, config?.cycle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (usage.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading usage…
      </div>
    );
  }
  if (!usage.data) return null;

  const { state } = usage.data;
  const limits = usage.data.config;
  const spent = state.cost_usd ?? 0;
  const cap = limits.budget_per_cycle;
  const over = cap != null && spent >= cap;
  const share = cap ? Math.min(1, spent / cap) : 0;
  const parsed = Number(budget.replace(/^\$/, ""));
  const budgetValid = budget.trim() === "" || (Number.isFinite(parsed) && parsed > 0);
  const changed =
    (budget.trim() === "" ? undefined : parsed) !== limits.budget_per_cycle || cycle !== limits.cycle;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!budgetValid || !changed) return;
    const next: UsageLimits = { ...limits, cycle };
    if (budget.trim() === "") delete next.budget_per_cycle;
    else next.budget_per_cycle = parsed;
    save.mutate(next);
  }

  return (
    <section aria-labelledby="peko-usage" className="rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between">
        <h3 id="peko-usage" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Wallet className="h-3.5 w-3.5 text-fg-muted" />
          Usage · {PERIOD[state.cycle]}
        </h3>
        <span className="text-[11px] text-fg-subtle">
          resets {new Date(state.window_end).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      <p className="mt-2 text-sm text-fg" data-testid="usage-spend">
        <span className={over ? "font-semibold text-danger" : "font-semibold"}>{formatUsd(spent)}</span>
        {cap != null ? ` of ${formatUsd(cap)} budget` : " spent"}
      </p>
      {cap != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          <div
            className={over ? "h-full bg-danger" : "h-full bg-brand"}
            style={{ width: `${Math.round(share * 100)}%` }}
          />
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-fg-muted">
        {formatTokens(state.input_tokens)} in · {formatTokens(state.output_tokens)} out ·{" "}
        {state.request_count} {state.request_count === 1 ? "request" : "requests"}
      </p>
      {over && (
        <p className="mt-1.5 text-[11px] text-danger" data-testid="usage-over-budget">
          Over budget — your peko won&apos;t call its model again until the budget resets or you
          raise it.
        </p>
      )}
      {!priced && (
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          Spend counts once the peko&apos;s model has a price (Settings → Models → Edit).
        </p>
      )}

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="usage-budget" className="text-[11px] text-fg-muted">
          Budget
        </label>
        <div className="flex items-center rounded-md border border-line bg-surface focus-within:border-brand">
          <span className="pl-2 text-xs text-fg-subtle">$</span>
          <input
            id="usage-budget"
            inputMode="decimal"
            placeholder="none"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-20 bg-transparent px-1.5 py-1 text-xs text-fg outline-none"
          />
        </div>
        <select
          aria-label="Budget period"
          value={cycle}
          onChange={(e) => setCycle(e.target.value as UsageCycle)}
          className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-fg"
        >
          {(Object.keys(PER) as UsageCycle[]).map((c) => (
            <option key={c} value={c}>
              {PER[c]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!budgetValid || !changed || save.isPending}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {!budgetValid && <span className="text-[11px] text-danger">Enter an amount above $0.</span>}
      </form>
      {save.error && (
        <p className="mt-1 text-[11px] text-danger">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      )}
    </section>
  );
}

