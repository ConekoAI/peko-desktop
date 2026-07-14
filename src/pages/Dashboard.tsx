import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePrincipals } from "../hooks/usePrincipals";
import { useExtensions } from "../hooks/useExtensions";
import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";
import {
  Bot,
  Puzzle,
  Plus,
  Globe,
  FileText,
} from "lucide-react";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  to?: string;
}) {
  const content = (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

export default function Dashboard() {
  const { data: principals } = usePrincipals();
  const { data: extensions } = useExtensions();
  // ADR-043 §adoption: the engine is invisible on the happy path.
  // The dashboard used to render an "Engine Running" card; that's
  // gone. When the engine fails, the layout-level EngineFailureCard
  // appears at the top of the page (above any route). When it
  // succeeds, nothing in the chrome mentions the engine — chat and
  // other engine-backed features just work.
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Overview of your Peko environment
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Bot}
          label="Principals"
          value={principals?.length ?? 0}
          sub="top-level runtime actors"
        />
        <StatCard icon={Puzzle} label="Extensions" value={extensions?.length ?? 0} to="/extensions" />
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Principal
          </button>
          <Link
            to="/registry"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Globe className="h-4 w-4" />
            Browse Registry
          </Link>
          <Link
            to="/daemon-logs"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <FileText className="h-4 w-4" />
            Daemon Log
          </Link>
        </div>
      </div>

      <CreatePrincipalModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
