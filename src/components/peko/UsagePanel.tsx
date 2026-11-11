import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { currentLocale } from "../../i18n";

import { principalSetLimits, principalUsage } from "../../lib/api";
import type { UsageCycle, UsageLimits } from "../../types";

const CYCLES: UsageCycle[] = ["hourly", "daily", "weekly", "monthly"];

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
  const { t } = useTranslation();
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
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("peko.usage.loading")}
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
    <section aria-labelledby="peko-usage" className="rounded-xl border border-line bg-surface-raised p-3.5">
      <div className="flex items-baseline justify-between">
        <h3 id="peko-usage" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Wallet className="h-3.5 w-3.5 text-fg-muted" />
          {t("peko.usage.title", { period: t(`peko.usage.period.${state.cycle}`) })}
        </h3>
        <span className="text-[11px] text-fg-subtle">
          {t("peko.usage.resets", {
            date: new Date(state.window_end).toLocaleString(currentLocale(), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </span>
      </div>

      <p className="mt-2 text-sm text-fg" data-testid="usage-spend">
        <Trans
          i18nKey={cap != null ? "peko.usage.spentOfBudget" : "peko.usage.spent"}
          values={{ cap: cap != null ? formatUsd(cap) : "" }}
          components={{
            amount: (
              <span className={over ? "font-semibold text-danger" : "font-semibold"}>
                {formatUsd(spent)}
              </span>
            ),
          }}
        />
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
        {t("peko.usage.tokensIn", { n: formatTokens(state.input_tokens) })}
        {(state.cache_read_tokens ?? 0) > 0 && (
          <span data-testid="usage-cached">
            {" "}
            {t("peko.usage.cached", { n: formatTokens(state.cache_read_tokens ?? 0) })}
          </span>
        )}{" "}
        · {t("peko.usage.tokensOut", { n: formatTokens(state.output_tokens) })} ·{" "}
        {t("peko.usage.requests", { count: state.request_count })}
      </p>
      {over && (
        <p className="mt-1.5 text-[11px] text-danger" data-testid="usage-over-budget">
          {t("peko.usage.over")}
        </p>
      )}
      {!priced && (
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          {t("peko.usage.unpriced")}
        </p>
      )}

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="usage-budget" className="text-[11px] text-fg-muted">
          {t("peko.usage.budget")}
        </label>
        <div className="flex items-center rounded-md border border-line-strong bg-surface-card transition-colors focus-within:border-peko-500 focus-within:ring-2 focus-within:ring-peko-500/20">
          <span className="pl-2 text-xs text-fg-subtle">$</span>
          <input
            id="usage-budget"
            inputMode="decimal"
            placeholder={t("peko.usage.none")}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-20 bg-transparent px-1.5 py-1 text-xs text-fg outline-none"
          />
        </div>
        <select
          aria-label={t("peko.usage.budgetPeriod")}
          value={cycle}
          onChange={(e) => setCycle(e.target.value as UsageCycle)}
          className="select input-sm w-auto pr-7"
        >
          {CYCLES.map((c) => (
            <option key={c} value={c}>
              {t(`peko.usage.per.${c}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!budgetValid || !changed || save.isPending}
          className="btn-primary btn-sm"
        >
          {save.isPending ? t("common.saving") : t("common.save")}
        </button>
        {!budgetValid && <span className="text-[11px] text-danger">{t("peko.usage.budgetInvalid")}</span>}
      </form>
      {save.error && (
        <p className="mt-1 text-[11px] text-danger">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      )}
    </section>
  );
}

