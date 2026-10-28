import { useNavigate, useLocation } from "@tanstack/react-router";
import { MessageCircle, Users, Settings } from "lucide-react";
import ProfileMenu from "./ProfileMenu";

export default function AppRail() {
  const navigate = useNavigate();
  const location = useLocation();

  const isHome =
    location.pathname === "/" ||
    location.pathname === "/chat" ||
    location.pathname.startsWith("/chat/");

  const isChannels =
    location.pathname === "/channels" ||
    location.pathname.startsWith("/channels/");

  const isSettings = location.pathname === "/settings";

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-2 border-r border-line bg-surface-raised py-3">
      {/* Home / Direct Messages */}
      <button
        onClick={() => navigate({ to: "/chat" })}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
          isHome
            ? "bg-brand-soft text-brand"
            : "text-fg-muted hover:bg-surface-sunken hover:text-fg-soft",
        ].join(" ")}
        title="Chats"
        aria-label="Chats"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      {/* PR-1: Channels (peko-channel cross-runtime). Same chrome
          shape as the Direct Messages icon — direct route, not a
          nested menu. The active style mirrors the chat icon's. */}
      <button
        onClick={() => navigate({ to: "/channels" })}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
          isChannels
            ? "bg-brand-soft text-brand"
            : "text-fg-muted hover:bg-surface-sunken hover:text-fg-soft",
        ].join(" ")}
        title="Groups"
        aria-label="Groups"
        data-testid="app-rail-channels"
      >
        <Users className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <button
        onClick={() => navigate({ to: "/settings" })}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
          isSettings
            ? "bg-brand-soft text-brand"
            : "text-fg-muted hover:bg-surface-sunken hover:text-fg-soft",
        ].join(" ")}
        title="Settings"
        aria-label="Settings"
        aria-current={isSettings ? "page" : undefined}
      >
        <Settings className="h-5 w-5" />
      </button>

      {/* PekoHub account — chrome-level sign-in / sign-out, accessible
          from any route. Owns the OAuth flow (ProfileMenu reuses
          useRuntimes hooks; no auth code lives here). The Settings
          link still lives inside the dropdown for navigation. */}
      <ProfileMenu />
    </aside>
  );
}