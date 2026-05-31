import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Bot,
  Users,
  MessageSquare,
  Puzzle,
  Globe,
  Clock,
  Radio,
  FileText,
  Settings,
} from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/teams", label: "Teams", icon: Users },
  { to: "/sessions", label: "Sessions", icon: MessageSquare },
  { to: "/extensions", label: "Extensions", icon: Puzzle },
  { to: "/registry", label: "Registry", icon: Globe },
  { to: "/cron", label: "Cron", icon: Clock },
  { to: "/event-bus", label: "Event Bus", icon: Radio },
  { to: "/logs", label: "Logs", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex h-full w-56 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="h-7 w-7 rounded-lg bg-indigo-600" />
        <span className="text-lg font-bold text-slate-900 dark:text-white">Peko</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
