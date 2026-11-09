import { useNavigate, useLocation } from "@tanstack/react-router";
import { MessageCircle, Settings } from "lucide-react";
import ProfileMenu from "./ProfileMenu";
import HubNotificationBell from "./HubNotificationBell";
import GroupRail from "./rail/GroupRail";
import { RailDivider, RailItem } from "./rail/RailItem";
import { useUnreadCounts } from "../lib/unread";

/**
 * The far-left rail: Chats on top, then every group you are in as its own
 * tile, then account and settings at the foot.
 */
export default function AppRail({ onCreateGroup }: { onCreateGroup?: () => void } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const unread = Object.values(useUnreadCounts()).reduce((sum, n) => sum + n, 0);

  const isHome =
    location.pathname === "/" ||
    location.pathname === "/chat" ||
    location.pathname.startsWith("/chat/") ||
    location.pathname === "/discover" ||
    // Runtime ADR-095 D6: DMs with people sit with the chats.
    location.pathname.startsWith("/people/");

  const isSettings = location.pathname === "/settings";

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center bg-surface-rail pb-3 pt-3">
      <RailItem
        label="Chats"
        active={isHome}
        ariaCurrent={isHome}
        unread={unread > 0}
        badge={unread}
        onClick={() => navigate({ to: "/chat" })}
        testId="app-rail-chats"
      >
        <MessageCircle className="h-5 w-5" />
      </RailItem>

      <RailDivider />

      <nav
        aria-label="Groups"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="app-rail-groups"
      >
        <GroupRail onCreateClick={onCreateGroup} />
      </nav>

      <div className="mt-2 flex w-full flex-col items-center gap-2 pt-2">
        <HubNotificationBell />
        <RailItem
          label="Settings"
          active={isSettings}
          ariaCurrent={isSettings}
          onClick={() => navigate({ to: "/settings" })}
          testId="app-rail-settings"
        >
          <Settings className="h-5 w-5" />
        </RailItem>
        {/* PekoHub account — sign in / out from any route. */}
        <ProfileMenu />
      </div>
    </aside>
  );
}
