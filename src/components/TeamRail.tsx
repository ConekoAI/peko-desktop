import { useNavigate, useLocation } from "@tanstack/react-router";
import { Settings, MessageCircle } from "lucide-react";

export default function TeamRail() {
  const navigate = useNavigate();
  const location = useLocation();

  const isHome =
    location.pathname === "/" ||
    location.pathname === "/chat" ||
    location.pathname.startsWith("/chat/");

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-2 border-r border-slate-200 bg-slate-50 py-3 dark:border-slate-800 dark:bg-slate-900">
      {/* Home / Direct Messages */}
      <button
        onClick={() => navigate({ to: "/chat" })}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
          isHome
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
        ].join(" ")}
        title="Direct Messages"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <button
        onClick={() => navigate({ to: "/settings" })}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        title="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>
    </aside>
  );
}
