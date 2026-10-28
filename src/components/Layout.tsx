import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import AppRail from "./AppRail";
import PrincipalSidebar from "./PrincipalSidebar";
import ChannelSidebar from "./ChannelSidebar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import EngineFailureCard from "./EngineFailureCard";
import VersionMismatchBanner from "./VersionMismatchBanner";
import FirstRunWalkthrough from "./FirstRunWalkthrough";
import CreatePrincipalModal from "./modals/CreatePrincipalModal";
import AddRemotePrincipalModal from "./modals/AddRemotePrincipalModal";
import ImportPekoModal from "./modals/ImportPekoModal";
import ChannelCreateModal from "./modals/ChannelCreateModal";
import { useEngineStatus } from "../hooks/useEngine";
import { useEngineVersionMismatch } from "../hooks/useEngine";
import { applyTheme } from "../lib/theme";
import { installDeepLinkHandler } from "../lib/deepLink";
import { useQueryClient } from "@tanstack/react-query";

export default function Layout({ children }: { children: React.ReactNode }) {
  // Engine state is invisible on the happy path (ADR-043 §adoption).
  // We still poll `useEngineStatus` so the failure card can surface
  // when the engine is in `Failed` (and so the layout reacts to the
  // CLI-daemon-died scenario for borrowed engines). The badge in
  // the header is gone — version/about links live in Settings → About.
  const { data: engine } = useEngineStatus();
  const { mismatch, dismiss } = useEngineVersionMismatch();
  // T-105: hoisted CreatePrincipalModal state so the sidebar's
  // empty-state CTA can open it. Chat.tsx and Dashboard.tsx keep
  // their own local instances (each already wired before the hoist);
  // only one modal is open at a time so the duplication is harmless.
  const [createOpen, setCreateOpen] = useState(false);
  // PR #4: layout-level AddRemotePrincipalModal so the sidebar's
  // "Connect" button can open it. Modal mutates the
  // remote-principals JSON table on the desktop; the sidebar
  // re-renders through React Query's invalidation hook.
  const [connectOpen, setConnectOpen] = useState(false);
  // ADR-056: layout-level ImportPekoModal so the sidebar's "Import
  // .peko" footer button can open it. The modal wakes a peko from a
  // package on disk; the backend reloads the daemon itself.
  const [importOpen, setImportOpen] = useState(false);
  // PR-3: layout-level ChannelCreateModal so the channels
  // sidebar's "+ New channel" button can open it. Mirrors the
  // CreatePrincipalModal hoist pattern.
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // PR #6: ephemeral toast surface for deep-link errors. Cleared
  // after 5s so a one-off mistyped URL doesn't leave a banner up
  // forever.
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  useEffect(() => {
    applyTheme();
  }, []);

  // P1.7 polish: listen for the `peko:open-channel-create` CustomEvent
  // dispatched by `Channels.tsx`'s empty-state CTA + the `?newChannel=1`
  // query-param branch. Lets the channels landing page open the
  // layout-level modal without prop-drilling an opener through the
  // route tree.
  useEffect(() => {
    const handler = () => setChannelCreateOpen(true);
    window.addEventListener("peko:open-channel-create", handler);
    return () => {
      window.removeEventListener("peko:open-channel-create", handler);
    };
  }, []);

  // PR #6: install deep-link handler at layout mount. The unlisten
  // runs at unmount so navigation away from the layout doesn't
  // leak listeners. Also subscribe to the success/error events so
  // a fresh deep-link auto-navigates to the new principal's chat
  // and surfaces failures as a transient toast.
  useEffect(() => {
    let unlistenHandled: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const unlisten = await installDeepLinkHandler();
        if (cancelled) {
          unlisten();
          return;
        }
        // The `installDeepLinkHandler` already wired the live path;
        // here we add the success/error event subscriptions.
        const { listen } = await import("@tauri-apps/api/event");
        unlistenHandled = await listen<{
          kind: string;
          shareUrl: string;
        }>("deep-link-handled", () => {
          // Invalidate the remote-principal query so the sidebar
          // picks up the new row immediately, then navigate to
          // the chat. The principal_name is not in the event
          // payload (just the shareUrl); we re-parse it here so
          // the router can target the right page.
          void qc.invalidateQueries({ queryKey: ["remote-principals"] });
        });
        unlistenError = await listen<string>("deep-link-error", (event) => {
          setDeepLinkError(event.payload);
          window.setTimeout(() => setDeepLinkError(null), 5_000);
        });
      } catch (e) {
        // Plugin not registered (dev / non-desktop). Silently
        // ignore — the user will see the modal's manual paste
        // path as a fallback.
        if (!cancelled) {
          console.warn("[peko-desktop] deep-link install failed:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenHandled?.();
      unlistenError?.();
    };
  }, [qc, navigate]);

  const engineFailed = engine?.kind === "failed";

  const isChatRoute =
    location.pathname === "/" || location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  // Discover lists pekos to add: it keeps the peko list beside it.
  const isPekoRoute = isChatRoute || location.pathname === "/discover";

  const isChannelsRoute =
    location.pathname === "/channels" ||
    location.pathname.startsWith("/channels/");

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface">
      {/* Custom title bar */}
      <TitleBar />

      {/* PR #6: deep-link error toast. Sits at z-50 above the
          title bar so a failed share-link import gets seen even
          on first-run flows. Auto-clears via the 5s timeout in
          the listener. */}
      {deepLinkError && (
        <div className="fixed right-4 top-12 z-50 max-w-sm rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-red-700 shadow-lg dark:text-red-300">
          {deepLinkError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Far left: app rail (always visible) */}
        <AppRail />

        {/* Context sidebar: the peko list beside chats, the group
            list beside groups, nothing beside full pages (Settings). */}
        {isPekoRoute ? (
          <PrincipalSidebar
            onCreateClick={() => setCreateOpen(true)}
            onConnectClick={() => setConnectOpen(true)}
            onImportClick={() => setImportOpen(true)}
          />
        ) : isChannelsRoute ? (
          <ChannelSidebar onCreateClick={() => setChannelCreateOpen(true)} />
        ) : null}

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Content */}
          {/* Chats and groups manage their own scrolling; full pages
              (Settings) scroll here. One overflow class each: with both,
              `overflow-hidden` won and Settings could not scroll. */}
          <main
            className={[
              "flex-1",
              isChatRoute || isChannelsRoute ? "overflow-hidden" : "overflow-auto p-6",
            ].join(" ")}
          >
            {/* Engine failure card. Only renders on Failed. On every
                other state (Stopped, Starting, Restarting, Running)
                the engine is invisible in the chrome — the user only
                needs to think about it when something needs action. */}
            {engineFailed && engine && (
              <div className="px-6 pb-3 pt-4">
                <EngineFailureCard
                  message={engine.message}
                />
              </div>
            )}

            {/* Version mismatch is full-width, above the page content
                so it stays visible even on chat routes where there's
                no padding scroll area. */}
            {mismatch && (
              <div className="px-6 pb-3 pt-4">
                <VersionMismatchBanner
                  actual={mismatch.actual}
                  expected={mismatch.expected}
                  onDismiss={dismiss}
                />
              </div>
            )}
            {children}
          </main>

          {/* Status bar — renders only on Failed (matches the
              layout-level failure card) so the happy path has no
              engine chrome at all. */}
          {engineFailed && <StatusBar />}
        </div>
      </div>

      {/* T-105: layout-level CreatePrincipalModal so the sidebar's
          empty-state CTA can open it. Chat and Dashboard keep their
          own local instances; only one is open at a time. */}
      <CreatePrincipalModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => navigate({ to: "/chat/$pekoName", params: { pekoName: name } })}
      />
      <AddRemotePrincipalModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ImportPekoModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ChannelCreateModal
        open={channelCreateOpen}
        onClose={() => setChannelCreateOpen(false)}
        onCreated={(channelId) =>
          navigate({
            to: "/channels/$channelId",
            params: { channelId },
          })
        }
      />

      {/* T-105: first-run walkthrough. Auto-appears when there are
          zero principals and the dismiss flag is unset. Renders its
          own `fixed inset-0 z-50` overlay when active, so it sits
          above everything else in the layout. */}
      <FirstRunWalkthrough />
    </div>
  );
}