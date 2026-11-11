import { useEffect } from "react";
import { Plus, Users } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/**
 * Groups landing page. Every group is a tile in the app rail
 * (`GroupRail`), so this page hosts an empty-state hint when no group
 * is open.
 *
 * P1.7 polish: the empty state now offers an in-app "+ New channel"
 * CTA. Reads `?newChannel=1` from the URL on mount and removes it
 * after dispatching — this lets the sidebar's "+ New channel"
 * button navigate to `/channels?newChannel=1` and open the layout-
 * level `ChannelCreateModal` without prop-drilling an opener
 * callback through the route tree.
 *
 * The CLI hint remains as a fallback for headless / scripted
 * workflows (tests, automation).
 */
export default function Channels() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { newChannel?: string };

  useEffect(() => {
    if (search.newChannel !== "1") return;
    // Dispatch a `CustomEvent` the layout-level modal listens for.
    // Using a synthetic event keeps the URL-side flag the source of
    // truth (no shared mutable state across mount boundaries) and
    // means a deep link to `/channels?newChannel=1` "just works".
    window.dispatchEvent(new CustomEvent("peko:open-channel-create"));
    // Strip the param so a refresh doesn't reopen the modal.
    const url = new URL(window.location.href);
    url.searchParams.delete("newChannel");
    window.history.replaceState({}, "", url.toString());
  }, [search.newChannel]);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm animate-fade-up flex-col items-center text-center">
        <div className="tile mb-4 h-14 w-14 rounded-2xl">
          <Users className="h-6 w-6" />
        </div>
        <h2 className="h-section">{t("channel.landing.title")}</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          {t("channel.landing.hint")}
        </p>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("peko:open-channel-create"));
          }}
          className="btn-primary mt-5"
          data-testid="channels-empty-new-button"
        >
          <Plus className="h-4 w-4" />
          {t("layout.rail.newGroup")}
        </button>
      </div>
    </div>
  );
}
