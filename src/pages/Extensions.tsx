import { useState } from "react";
import {
  useExtensions,
  useInstallExtension,
  useUninstallExtension,
} from "../hooks/useExtensions";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";

import { Plus, Trash2, X, Loader2 } from "lucide-react";
import type { ExtensionSummary } from "../types";

function InstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const install = useInstallExtension();
  const [path, setPath] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    install.mutate(path.trim(), { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Install Extension</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Path or URL
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/extension or https://..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
              Enter a local file path or remote URL to the extension package.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={install.isPending || !path.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Install
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Extensions() {
  const { data: extensions, isLoading } = useExtensions();
  const uninstall = useUninstallExtension();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: ExtensionSummary) => (
        <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>
      ),
    },
    {
      key: "version",
      header: "Version",
      sortable: true,
      render: (row: ExtensionSummary) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">{row.version}</span>
      ),
    },
    {
      key: "extType",
      header: "Type",
      sortable: true,
      render: (row: ExtensionSummary) => (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {row.extType}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      sortable: true,
      render: (row: ExtensionSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.source === "built-in"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
          ].join(" ")}
        >
          {row.source}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      sortable: false,
      render: (row: ExtensionSummary) => (
        <span className="max-w-xs truncate text-xs text-slate-600 dark:text-slate-400">
          {row.description || "—"}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Status",
      sortable: true,
      render: (row: ExtensionSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.enabled
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
          ].join(" ")}
        >
          {row.enabled ? "Enabled" : "Disabled"}
        </span>
      ),
    },
    {
      key: "capabilities",
      header: "Capabilities",
      sortable: false,
      render: (row: ExtensionSummary) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {row.provides.length === 0 ? (
            <span className="text-xs text-slate-400 dark:text-slate-600">—</span>
          ) : (
            row.provides.slice(0, 6).map((cap) => (
              <span
                key={cap}
                className="inline-flex max-w-[8rem] truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                title={cap}
              >
                {cap}
              </span>
            ))
          )}
          {row.provides.length > 6 && (
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              +{row.provides.length - 6}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (row: ExtensionSummary) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setConfirmId(row.id);
              setConfirmName(row.name);
            }}
            disabled={row.source === "built-in"}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title={row.source === "built-in" ? "Built-in extensions cannot be uninstalled" : "Uninstall"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Extensions</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage installed and built-in extensions
          </p>
        </div>
        <button
          onClick={() => setInstallOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Install Extension
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={extensions ?? []}
          keyExtractor={(r) => r.id}
          emptyText="No extensions installed"
        />
      )}

      <ConfirmModal
        open={!!confirmId}
        title="Uninstall Extension"
        message={`Are you sure you want to uninstall "${confirmName ?? ""}"?`}
        variant="danger"
        confirmText="Uninstall"
        onConfirm={() => {
          if (confirmId) uninstall.mutate(confirmId);
          setConfirmId(null);
          setConfirmName(null);
        }}
        onCancel={() => {
          setConfirmId(null);
          setConfirmName(null);
        }}
      />

      <InstallModal open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
}
