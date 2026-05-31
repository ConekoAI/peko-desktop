import { useState } from "react";
import {
  useExtensions,
  useEnableExtension,
  useDisableExtension,
  useUninstallExtension,
} from "../hooks/useExtensions";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { Plus, Power, PowerOff, Trash2 } from "lucide-react";
import type { ExtensionSummary } from "../types";

export default function Extensions() {
  const { data: extensions, isLoading } = useExtensions();
  const enable = useEnableExtension();
  const disable = useDisableExtension();
  const uninstall = useUninstallExtension();
  const [confirmName, setConfirmName] = useState<string | null>(null);

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
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          v{row.version}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      sortable: false,
      render: (row: ExtensionSummary) => (
        <span className="text-slate-600 dark:text-slate-400">{row.description ?? "—"}</span>
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
      key: "installedAt",
      header: "Installed",
      sortable: true,
      render: (row: ExtensionSummary) => formatDate(row.installedAt),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (row: ExtensionSummary) => (
        <div className="flex items-center gap-2">
          {row.enabled ? (
            <button
              onClick={() => disable.mutate(row.name)}
              className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
              title="Disable"
            >
              <PowerOff className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => enable.mutate(row.name)}
              className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
              title="Enable"
            >
              <Power className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setConfirmName(row.name)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title="Uninstall"
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
            Manage installed extensions
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
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
          keyExtractor={(r) => r.name}
          emptyText="No extensions installed"
        />
      )}

      <ConfirmModal
        open={!!confirmName}
        title="Uninstall Extension"
        message={`Are you sure you want to uninstall "${confirmName ?? ""}"?`}
        variant="danger"
        confirmText="Uninstall"
        onConfirm={() => {
          if (confirmName) uninstall.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />
    </div>
  );
}
