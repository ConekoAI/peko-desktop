import { useState } from "react";
import {
  usePrincipalReload,
  useRegistrySearch,
  useRegistryPull,
} from "../hooks/useRegistry";
import BundleCard from "../components/BundleCard";
import { Check, Copy, Loader2, RefreshCw, Search, X } from "lucide-react";

export default function Registry() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 12;

  const { data, isLoading } = useRegistrySearch(query, page, perPage);
  const pull = useRegistryPull();
  const reload = usePrincipalReload();
  const [copied, setCopied] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  // The CLI grounding command for the pulled seed. Create-from-seed
  // is CLI-local (the runtime's `principal_create` IPC packet has no
  // seed field), so the post-pull panel shows this command instead of
  // an in-app create button.
  const seedCommand = pull.data
    ? `peko create my-peko -s ${pull.data.name}.seed.toml`
    : null;

  async function handleCopyCommand() {
    if (!seedCommand) return;
    // navigator.clipboard is unavailable in older WebViews and some
    // Tauri permission profiles; fall back to a hidden-textarea
    // selection so the action still works in either environment.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(seedCommand);
      } else {
        const ta = document.createElement("textarea");
        ta.value = seedCommand;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Swallow: clipboard write failed (permissions / non-secure
      // context). The command text remains selectable for manual copy.
    }
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Registry</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search and pull seeds from PekoHub
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search seeds..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-600"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {pull.isSuccess && pull.data && seedCommand && (
        <div
          data-testid="seed-create-panel"
          className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              Create your peko from this seed
            </h3>
            <button
              onClick={() => pull.reset()}
              aria-label="Dismiss"
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            Pulled <span className="font-semibold">{pull.data.name}</span>{" "}
            v{pull.data.version}. Growing a seed is a CLI flow — the desktop
            can&apos;t do it for you yet. Run this in a terminal:
          </p>

          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-emerald-900 dark:bg-slate-950 dark:text-emerald-100">
              {seedCommand}
            </code>
            <button
              onClick={handleCopyCommand}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-950 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="text-xs text-emerald-800 dark:text-emerald-300">
            Once the command finishes, the peko appears in the desktop — click
            refresh to pick it up.
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={() => reload.mutate()}
              disabled={reload.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {reload.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh peko list
            </button>
            {reload.isSuccess && (
              <span className="text-xs text-emerald-800 dark:text-emerald-300">
                List refreshed — your peko shows up once the CLI create has run.
              </span>
            )}
          </div>

          {reload.isError && (
            <p className="text-xs text-red-700 dark:text-red-400">
              {reload.error instanceof Error
                ? reload.error.message
                : "Failed to refresh the peko list."}
            </p>
          )}
        </div>
      )}

      {data && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <BundleCard
                key={item.ref}
                bundle={item}
                onInstall={(ref) => pull.mutate(ref)}
                isInstalling={pull.isPending && pull.variables === item.ref}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                Previous
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : query.length > 0 && !isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">
          No results found for &quot;{query}&quot;
        </div>
      ) : null}

      {pull.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {pull.error instanceof Error
            ? pull.error.message
            : "Failed to pull seed."}
        </div>
      )}
    </div>
  );
}
