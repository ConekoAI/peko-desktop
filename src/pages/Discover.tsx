import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      <header className="border-b border-line bg-surface px-8 pb-5 pt-8">
        <h1 className="h-page">{t("discover.title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          <Trans
            i18nKey="discover.intro"
            components={{ code: <code />, hub: <code className="code-inline">{hubUrl}</code> }}
          />
        </p>
      </header>

      <form
        className="border-b border-line px-8 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("discover.placeholder")}
            aria-label={t("discover.label")}
            className="input pl-10 pr-3"
          />
        </div>
      </form>

      <section className="flex-1 overflow-y-auto px-8 py-6">
        {!q ? (
          <div className="rounded-xl border border-dashed border-line-strong p-12 text-center text-sm text-fg-muted">
            <Trans i18nKey="discover.empty" components={{ code: <code /> }} />
          </div>
        ) : search.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-fg-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : search.error ? (
          <div className="rounded-xl border border-warn/25 bg-warn-soft p-4 text-sm text-warn">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {t("discover.unreachable")}
                <p className="mt-1 text-xs">
                  {search.error instanceof Error ? search.error.message : t("errors.unknown")}
                </p>
              </div>
            </div>
          </div>
        ) : !data || (data.exact.length === 0 && data.items.length === 0) ? (
          <div className="rounded-xl border border-dashed border-line-strong p-12 text-center text-sm text-fg-muted">
            {byId
              ? t("discover.noOne", { id: q })
              : t("discover.noSeeds")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  const { t } = useTranslation();
  return (
    <article className="card card-hover flex flex-col p-5">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium text-fg">
            {avatar && (
              <span aria-hidden="true" className="mr-1.5 select-none">
                {avatar}
              </span>
            )}
            {title}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{id}</p>
        </div>
        <span className="badge-neutral shrink-0">
          {t(`discover.kind.${kind}`)}
        </span>
      </header>

      {description && (
        <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{description}</p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 pt-4">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="link inline-flex items-center gap-1 text-xs font-medium"
        >
          <ExternalLink className="h-3 w-3" />
          {t("discover.openInBrowser")}
        </a>
        {addLink && (
          <a
            href={addLink}
            className="btn-secondary btn-sm"
          >
            <Plus className="h-3 w-3" />
            {t("discover.addToDesktop")}
          </a>
        )}
      </footer>
    </article>
  );
}
