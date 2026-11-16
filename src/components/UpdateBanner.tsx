import { useState } from "react";
import { ArrowUpCircle, ExternalLink, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DOWNLOAD_PAGE_URL } from "../lib/api";
import { useAppUpdate, useUpdateInstall, type InstallState } from "../hooks/useAppUpdate";

const DISMISSED_KEY = "peko-update-dismissed";

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** What the update button says while the update is under way. */
export function installLabel(state: InstallState, t: TFunction): string {
  if (state.phase === "installing") return t("layout.update.installing");
  if (state.phase === "downloading") {
    return state.fraction === null
      ? t("layout.update.downloading")
      : t("layout.update.downloadingPercent", { percent: Math.round(state.fraction * 100) });
  }
  return t("layout.update.install");
}

/**
 * A quiet line above the page when a newer Peko Desktop exists. One
 * button downloads it, installs it and restarts the app. Where the app
 * can't replace itself (a Linux package install), it links the download
 * page instead. Dismissing hides it until the next version; Settings →
 * About always has it.
 */
export default function UpdateBanner() {
  const { t } = useTranslation();
  const { data } = useAppUpdate();
  const { state, busy, install } = useUpdateInstall();
  const [dismissed, setDismissed] = useState(dismissedVersion);

  const version = data?.available;
  if (!version || (dismissed === version && !busy)) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, version ?? "");
    } catch {
      // Hidden for this session only.
    }
    setDismissed(version ?? null);
  }

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-sunken px-4 py-2.5 text-sm text-fg-soft"
    >
      <ArrowUpCircle className="h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {state.phase === "failed" ? t("layout.update.failed") : t("layout.update.available", { version })}
      </p>
      {data.canInstall && state.phase !== "failed" ? (
        <button type="button" onClick={() => void install()} disabled={busy} className="btn-primary">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {installLabel(state, t)}
        </button>
      ) : (
        <button type="button" onClick={() => void openUrl(DOWNLOAD_PAGE_URL)} className="btn-secondary">
          {t("layout.update.downloadPage")}
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {!busy && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("layout.update.dismiss")}
          className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface hover:text-fg-soft"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Settings → About: ask for a newer version now, and install it from here. */
export function UpdateRow() {
  const { t } = useTranslation();
  const update = useAppUpdate();
  const { state, busy, install } = useUpdateInstall();
  // Say how a check went only once the person asked for one.
  const [asked, setAsked] = useState(false);
  const version = update.data?.available;

  let note: string | null = null;
  if (state.phase === "failed") note = t("layout.update.failed");
  else if (version) note = t("settings.about.updateAvailable", { version });
  else if (asked && update.isError && !update.isFetching) note = t("settings.about.checkFailed");
  else if (asked && update.data && !update.isFetching) note = t("settings.about.upToDate");

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="update-row">
      <dt className="min-w-0 text-fg-muted" aria-live="polite">
        {note ?? t("settings.about.updates")}
      </dt>
      <dd className="flex flex-shrink-0 items-center gap-2">
        {version && update.data?.canInstall && state.phase !== "failed" ? (
          <button type="button" onClick={() => void install()} disabled={busy} className="btn-primary">
            {installLabel(state, t)}
          </button>
        ) : version ? (
          <button type="button" onClick={() => void openUrl(DOWNLOAD_PAGE_URL)} className="btn-secondary">
            {t("layout.update.downloadPage")}
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAsked(true);
              void update.refetch();
            }}
            disabled={update.isFetching}
            className="btn-secondary"
          >
            {update.isFetching ? t("settings.about.checking") : t("settings.about.checkUpdates")}
          </button>
        )}
      </dd>
    </div>
  );
}
