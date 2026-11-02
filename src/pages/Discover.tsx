import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search as SearchIcon,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Plus,
} from "lucide-react";
import { hubSearch, deepLinkFor, shareUrlFor, resolveHubUrl, type ExactHit } from "../lib/discovery";
import { useSettings } from "../hooks/useSettings";
import { hubWebOrigin } from "../lib/api";

/**
 * Find a peko, a person or a seed on the selected PekoHub.
 *
 * The hub lists no one (pekohub ADR-009): people and public pekos are
 * found by their exact ID — `@alice`, `@alice/ada` — and seeds by text.
 * A peko found here can be added to the desktop: "Add to desktop"
 * invokes the same `peko://add-peko` deep link a share link does, so it
 * goes through `installDeepLinkHandler` like a link clicked elsewhere.
 * People and seeds open on the hub's website.
 */
export default function Discover() {
  const { data: settings } = useSettings();
  const hubUrl = resolveHubUrl(settings?.find((s) => s.key === "pekohub.base_url")?.value);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  const search = useQuery({
    queryKey: ["hub-search", { hubUrl, q }] as const,
    queryFn: () => hubSearch(hubUrl, q),
    enabled: q.length > 0,
    retry: 1,
  });

  const data = search.data;
  const byId = data?.queryKind === "person" || data?.queryKind === "peko";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Find a peko</h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          People and pekos are found by their exact ID, like <code>@alice/ada</code>. Seeds can be
          searched by name. On{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">{hubUrl}</code>
        </p>
      </header>

      <form
        className="border-b border-slate-200 px-6 py-4 dark:border-slate-800"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="@alice/ada, or search seeds…"
            aria-label="Peko ID or search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </form>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        {!q ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            PekoHub doesn&apos;t list pekos. Ask for one&apos;s ID — <code>@owner/name</code> — and
            look it up here.
          </div>
        ) : search.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : search.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Couldn&apos;t reach the hub.
                <p className="mt-1 text-xs">
                  {search.error instanceof Error ? search.error.message : "Unknown error"}
                </p>
              </div>
            </div>
          </div>
        ) : !data || (data.exact.length === 0 && data.items.length === 0) ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            {byId
              ? `No one public is ${q}. Check the spelling, or ask its owner whether it is public.`
              : "No seeds matched. Pekos are found only by their exact ID, like @alice/ada."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.exact.map((hit) => (
              <ExactCard key={`${hit.kind}:${hit.id}`} hit={hit} hubUrl={hubUrl} />
            ))}
            {!byId &&
              data.items.map((seed) => (
                <ResultCard
                  key={`seed:${seed.namespace}/${seed.name}`}
                  kind="seed"
                  title={seed.name}
                  id={`${seed.namespace}/${seed.name}`}
                  description={seed.description ?? null}
                  href={`${hubWebOrigin(hubUrl)}/${seed.namespace}/${seed.name}`}
                />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ExactCard({ hit, hubUrl }: { hit: ExactHit; hubUrl: string }) {
  if (hit.kind === "peko") {
    return (
      <ResultCard
        kind="peko"
        title={hit.displayName}
        avatar={hit.avatar}
        id={hit.id}
        description={hit.description}
        href={shareUrlFor(hubUrl, hit)}
        addLink={deepLinkFor(hubUrl, hit)}
      />
    );
  }
  return (
    <ResultCard
      kind={hit.kind}
      title={hit.displayName ?? hit.id}
      id={hit.id}
      description={hit.kind === "seed" ? hit.description : null}
      href={hit.url}
    />
  );
}

function ResultCard({
  kind,
  title,
  avatar,
  id,
  description,
  href,
  addLink,
}: {
  kind: ExactHit["kind"];
  title: string;
  avatar?: string | null;
  id: string;
  description: string | null;
  href: string;
  addLink?: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900 dark:text-white">
            {avatar && (
              <span aria-hidden="true" className="mr-1.5 select-none">
                {avatar}
              </span>
            )}
            {title}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{id}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {kind}
        </span>
      </header>

      {description && (
        <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{description}</p>
      )}

      <footer className="mt-4 flex items-center justify-between gap-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          <ExternalLink className="h-3 w-3" />
          Open in browser
        </a>
        {addLink && (
          <a
            href={addLink}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Plus className="h-3 w-3" />
            Add to desktop
          </a>
        )}
      </footer>
    </article>
  );
}
