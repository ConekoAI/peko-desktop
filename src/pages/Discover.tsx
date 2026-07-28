import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search as SearchIcon,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Plus,
} from "lucide-react";
import { discoverySearch, deepLinkFor, shareUrlFor, resolveHubUrl } from "../lib/discovery";

/**
 * PR #8: in-app discover page for peko-desktop. Searches the
 * currently-selected PekoHub over HTTPS and renders a card grid.
 * Each card has two actions:
 *
 * 1. "Open in browser" → opens the share URL in the system
 *    browser (system default). Used when the user wants to chat
 *    anonymously without adding the principal.
 * 2. "Add to desktop" → invokes the same `peko://` deep-link that
 *    PR #6 already wires. Tauri routes this through the
 *    `installDeepLinkHandler` we just shipped, so clicking it is
 *    indistinguishable from a cross-app share-link click.
 *
 * If the search is empty (no hub configured, network failure),
 * we fall back to opening the hub URL in the system browser so
 * the user always has a path forward.
 */
export default function Discover() {
  const hubUrl = resolveHubUrl();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | undefined>(undefined);

  const queryKey = useMemo(
    () => ["discovery", "search", { hubUrl, q, category }] as const,
    [hubUrl, q, category],
  );

  const search = useQuery({
    queryKey,
    queryFn: () =>
      discoverySearch(hubUrl, {
        q: q.trim() || undefined,
        category,
      }),
    retry: 1,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Discover public principals
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Searching <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">{hubUrl}</code>
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search public principals..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <CategoryChips value={category} onChange={setCategory} />
      </div>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        {search.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : search.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Couldn't reach the hub.{" "}
                <a
                  href={hubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  Open {hubUrl} in your browser
                </a>{" "}
                to browse manually.
                <p className="mt-1 text-xs">
                  {search.error instanceof Error ? search.error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          </div>
        ) : !search.data || search.data.hits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            No public principals matched. Try a different query.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {search.data.hits.map((hit) => (
              <DiscoverCard key={hit.id} hit={hit} hubUrl={hubUrl} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const CATEGORIES: Array<{ value: string; label: string } | null> = [
  null,
  { value: "productivity", label: "Productivity" },
  { value: "coding", label: "Coding" },
  { value: "creative", label: "Creative" },
  { value: "business", label: "Business" },
  { value: "entertainment", label: "Entertainment" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

function CategoryChips({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CATEGORIES.map((cat) => {
        const selected = (cat?.value ?? undefined) === value;
        return (
          <button
            key={cat?.value ?? "__all__"}
            type="button"
            onClick={() => onChange(cat?.value)}
            className={
              selected
                ? "rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30"
                : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }
          >
            {cat?.label ?? "All categories"}
          </button>
        );
      })}
    </div>
  );
}

function DiscoverCard({
  hit,
  hubUrl,
}: {
  hit: import("../lib/discovery").DiscoveryHit;
  hubUrl: string;
}) {
  const shareUrl = shareUrlFor(hubUrl, hit);
  const deepLink = deepLinkFor(hubUrl, hit);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900 dark:text-white">
            {hit.publicName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            @{hit.ownerName}
          </p>
        </div>
        {hit.featured && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Featured
          </span>
        )}
      </header>

      {hit.description && (
        <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">
          {hit.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {hit.category && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {hit.category}
          </span>
        )}
        {hit.tags.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
          >
            {t}
          </span>
        ))}
      </div>

      <footer className="mt-4 flex items-center justify-between gap-2">
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          <ExternalLink className="h-3 w-3" />
          Open in browser
        </a>
        <a
          href={deepLink}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Plus className="h-3 w-3" />
          Add to desktop
        </a>
      </footer>
    </article>
  );
}