import { useState } from "react";
import { useRegistrySearch, useRegistryPull } from "../hooks/useRegistry";
import BundleCard from "../components/BundleCard";
import { Search, Loader2 } from "lucide-react";

export default function Registry() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 12;

  const { data, isLoading } = useRegistrySearch(query, page, perPage);
  const pull = useRegistryPull();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Registry</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search and install bundles from PekoHub
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
            placeholder="Search bundles..."
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
          No results found for "{query}"
        </div>
      ) : null}

      {pull.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {pull.error instanceof Error
            ? pull.error.message
            : "Failed to install bundle."}
        </div>
      )}
    </div>
  );
}