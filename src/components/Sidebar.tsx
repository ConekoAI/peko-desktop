import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Puzzle,
  Globe,
  Clock,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const navItems = [
  { to: "/extensions", label: "Extensions", icon: Puzzle },
  { to: "/registry", label: "Registry", icon: Globe },
  { to: "/cron", label: "Cron", icon: Clock },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  function isActive(item: (typeof navItems)[0]) {
    return (
      location.pathname === item.to ||
      (item.to !== "/" && location.pathname.startsWith(`${item.to}/`))
    );
  }

  return (
    <aside
      className={[
        "flex h-full flex-col border-r border-slate-200 bg-slate-50 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900",
        collapsed ? "w-16" : "w-48",
      ].join(" ")}
    >
      <div className="flex h-14 items-center justify-end px-4">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
                collapsed ? "justify-center" : "",
              ].join(" ")}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
