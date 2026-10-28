import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  useGenericCredentialList,
  useSetGenericCredential,
  useDeleteCredentialById,
  useCredentialMaterial,
} from "../hooks/useSettings";
import { useModels } from "../hooks/useModels";
import { useEngineStatus } from "../hooks/useEngine";
import { useRuntimes, useAddRuntime, useRemoveRuntime, useReconnectRuntime, useRenameRuntime } from "../hooks/useRuntimes";
import { getTheme, setTheme } from "../lib/theme";
import { pekoHomeDir } from "../lib/api";
import { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";
import AddModelModal from "../components/modals/AddModelModal";
import ModelGalleryCard from "../components/models/ModelGalleryCard";
import {
  Save,
  Key,
  Info,
  Check,
  Trash2,
  Loader2,
  Sun,
  Moon,
  Monitor,
  FolderOpen,
  Globe,
  Monitor as MonitorIcon,
  Plus,
  X,
  RefreshCw,
  Edit3,
  Cpu,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Wrench,
  ExternalLink,
} from "lucide-react";
import type { RuntimeConnection, CredentialDetail, CredentialKind } from "../types";

type Section = "general" | "models" | "advanced" | "about";

const CARD = "rounded-xl border border-line bg-surface-card p-5";

function GeneralSection() {
  const [theme, setThemeState] = useState(getTheme);

  function choose(next: "light" | "dark" | "system") {
    setThemeState(next);
    setTheme(next);
  }

  return (
    <div className={CARD}>
      <h3 className="mb-4 text-sm font-semibold text-fg">Appearance</h3>
      <div role="radiogroup" aria-label="Theme" className="flex gap-2">
        {(["light", "dark", "system"] as const).map((t) => {
          const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
          return (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              onClick={() => choose(t)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                theme === t
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface-card text-fg-soft hover:bg-surface-sunken",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StoredKeys() {
  const { data: credentials, isLoading } = useGenericCredentialList();
  const setCred = useSetGenericCredential();
  const [namespace, setNamespace] = useState("llm");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CredentialKind>("api_key");
  const [material, setMaterial] = useState("");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !material.trim()) return;
    setCred.mutate(
      {
        namespace: namespace.trim(),
        name: name.trim(),
        kind,
        material: material.trim(),
      },
      {
        onSuccess: () => {
          setName("");
          setMaterial("");
        },
      },
    );
  }

  return (
    <div>
      <div className={CARD}>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-fg">
            Stored keys
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Every secret in the engine&apos;s vault. Model keys are managed
            from Models; this list is for keys other tools use.
          </p>
        </div>

        <form
          data-testid="add-credential-form"
          onSubmit={handleSave}
          className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-line p-3"
        >
          <h4 className="col-span-2 text-xs font-semibold text-fg-soft">Add a key</h4>
          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-muted">Namespace</span>
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. github"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-muted">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CredentialKind)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
            >
              <option value="api_key">API key</option>
              <option value="bearer_token">Bearer token</option>
              <option value="oauth_token">OAuth token</option>
              <option value="basic_auth">Basic auth</option>
              <option value="private_key">Private key</option>
              <option value="generic_secret">Other secret</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-muted">Secret</span>
            <input
              type="password"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              autoComplete="off"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
            />
          </label>
          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={!name.trim() || !material.trim() || setCred.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {setCred.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save key
            </button>
          </div>
        </form>

        {isLoading && (
          <p className="py-6 text-center text-xs text-fg-muted">
            Loading credentials…
          </p>
        )}

        {!isLoading && (credentials?.length ?? 0) === 0 && (
          <div
            data-testid="credentials-empty-state"
            className="rounded-lg border border-dashed border-line px-4 py-8 text-center"
          >
            <Key className="mx-auto mb-2 h-6 w-6 text-fg-subtle" />
            <p className="text-sm font-medium text-fg-soft">
              No stored keys
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              Keys you add for models or tools appear here.
            </p>
          </div>
        )}

        {!isLoading && (credentials?.length ?? 0) > 0 && (
          <div
            data-testid="credentials-rows"
            className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-lg border border-line"
          >
            {credentials?.map((c) => (
              <CredentialRow key={c.id} credential={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CredentialRow({ credential }: { credential: CredentialDetail }) {
  const deleteCred = useDeleteCredentialById();

  return (
    <div
      data-testid={`credential-row-${credential.id}`}
      className="bg-surface-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-fg">
            {credential.namespace}/{credential.name}
          </span>
          <span className="rounded bg-surface-sunken px-1 py-0.5 text-[10px] uppercase text-fg-muted">
            {credential.kind}
          </span>
          {credential.lastTestedAt && (
            <span className="text-[10px] text-fg-subtle">
              {credential.lastTestedOk ? "✓" : "✗"}{" "}
              {new Date(credential.lastTestedAt).toLocaleString()}
            </span>
          )}
        </div>
        <button
          onClick={() => deleteCred.mutate(credential.id)}
          disabled={deleteCred.isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-danger/30 bg-surface-card px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
      <RevealButton id={credential.id} />
    </div>
  );
}

function RevealButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useCredentialMaterial(id, open ? "reveal" : "");

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg-soft"
      >
        {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {open ? "Hide secret" : "Reveal secret"}
      </button>
      {open && (
        <div className="mt-1">
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-fg-subtle" />
          ) : (
            <input
              type="text"
              readOnly
              value={data ?? ""}
              className="w-full rounded border border-line bg-surface-sunken px-2 py-1 font-mono text-[10px] text-fg-soft outline-none"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModelsSection() {
  const { data: models, isLoading, isError } = useModels();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-fg">
              Models
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              The endpoints your pekos think with. Each model keeps its own API key; change it under Edit.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            data-testid="open-add-model-modal"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Add model
          </button>
        </div>

        {isLoading && (
          <p className="py-6 text-center text-xs text-fg-muted">
            Loading models…
          </p>
        )}

        {!isLoading && !isError && (models?.length ?? 0) === 0 && (
          <div
            data-testid="models-empty-state"
            className="rounded-lg border border-dashed border-line px-4 py-8 text-center"
          >
            <Cpu className="mx-auto mb-2 h-6 w-6 text-fg-subtle" />
            <p className="text-sm font-medium text-fg-soft">
              No models configured yet
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              Add an endpoint and its API key to start talking to your pekos.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Add your first model
            </button>
          </div>
        )}

        {!isLoading && !isError && (models?.length ?? 0) > 0 && (
          <div
            data-testid="models-gallery"
            className="max-h-[60vh] overflow-y-auto rounded-lg"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models?.map((m) => <ModelGalleryCard key={m.id} model={m} />)}
            </div>
          </div>
        )}

        {isError && (
          <div
            data-testid="models-catalog-unavailable"
            className="rounded-xl border border-warn/30 bg-warn-soft p-4"
          >
            <div className="mb-1 flex items-center gap-2">
              <Info className="h-4 w-4 text-warn" />
              <h3 className="text-sm font-semibold text-warn">
                Model catalog unavailable
              </h3>
            </div>
            <p className="text-xs text-warn">
              Couldn&apos;t load the model catalog from the runtime. Check
              that the engine is running and reload this tab.
            </p>
          </div>
        )}
      </div>

      <AddModelModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={() => {}}
      />
    </div>
  );
}

function Runtimes() {
  const { data: runtimes, isLoading } = useRuntimes();
  const addRuntime = useAddRuntime();
  const removeRuntime = useRemoveRuntime();
  const reconnectRuntime = useReconnectRuntime();
  const renameRuntime = useRenameRuntime();

  const [showAdd, setShowAdd] = useState(false);
  const [newRuntimeId, setNewRuntimeId] = useState("");
  const [newRuntimeName, setNewRuntimeName] = useState("");
  const [newRuntimeUrl, setNewRuntimeUrl] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  // PekoHub OAuth sign-in / sign-out now lives in the AppRail's
  // ProfileMenu component (chrome-level, accessible from any route).
  // The base URL / scope settings are read there; this tab only
  // needs the runtime list + add/remove flows.

  function handleAdd() {
    if (!newRuntimeId.trim() || !newRuntimeName.trim()) return;
    addRuntime.mutate(
      {
        id: newRuntimeId.trim(),
        name: newRuntimeName.trim(),
        pekohubUrl: newRuntimeUrl.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowAdd(false);
          setNewRuntimeId("");
          setNewRuntimeName("");
          setNewRuntimeUrl("");
        },
      }
    );
  }

  function startRename(runtime: RuntimeConnection) {
    setEditingName(runtime.id);
    setEditNameValue(runtime.name);
  }

  function commitRename(id: string) {
    if (editNameValue.trim()) {
      renameRuntime.mutate({ id, name: editNameValue.trim() });
    }
    setEditingName(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg">Runtimes</h3>
          <p className="text-xs text-fg-muted">
            This computer&apos;s engine, and remote engines you connect to by id.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-card px-3 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
          >
            <Plus className="h-4 w-4" />
            Add Remote
          </button>
        </div>
      </div>

      {/* Manual add form */}
      {showAdd && (
        <div className="rounded-xl border border-line bg-surface-card p-4">
          <h4 className="mb-3 text-sm font-semibold text-fg">Add Remote Runtime</h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Runtime ID</label>
              <input
                type="text"
                value={newRuntimeId}
                onChange={(e) => setNewRuntimeId(e.target.value)}
                placeholder="e.g. did:key:z6Mk..."
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Display Name</label>
              <input
                type="text"
                value={newRuntimeName}
                onChange={(e) => setNewRuntimeName(e.target.value)}
                placeholder="e.g. Home Server"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                PekoHub URL (optional)
              </label>
              <input
                type="text"
                value={newRuntimeUrl}
                onChange={(e) => setNewRuntimeUrl(e.target.value)}
                placeholder="https://pekohub.org/api"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={addRuntime.isPending || !newRuntimeId.trim() || !newRuntimeName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {addRuntime.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-card px-4 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading runtimes...
          </div>
        ) : runtimes && runtimes.length > 0 ? (
          runtimes.map((runtime) => (
            <div
              key={runtime.id}
              className="group flex items-center justify-between rounded-xl border border-line bg-surface-card p-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    runtime.connectionType === "local"
                      ? "bg-surface-sunken"
                      : "bg-brand-soft",
                  ].join(" ")}
                >
                  {runtime.connectionType === "local" ? (
                    <MonitorIcon className="h-4 w-4 text-fg-muted" />
                  ) : (
                    <Globe className="h-4 w-4 text-brand" />
                  )}
                </div>
                <div>
                  {editingName === runtime.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(runtime.id);
                          if (e.key === "Escape") setEditingName(null);
                        }}
                        autoFocus
                        className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-brand"
                      />
                      <button
                        onClick={() => commitRename(runtime.id)}
                        className="rounded p-1 text-brand hover:bg-brand-soft"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {runtime.name}
                      </span>
                      <button
                        onClick={() => startRename(runtime)}
                        className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg-soft group-hover:opacity-100"
                        title="Rename"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <span className="capitalize">{runtime.connectionType}</span>
                    <span>·</span>
                    <span
                      className={[
                        runtime.status === "connected"
                          ? "text-brand"
                          : runtime.status === "error"
                            ? "text-danger"
                            : runtime.status === "connecting"
                              ? "text-warn"
                              : "text-fg-subtle",
                      ].join(" ")}
                    >
                      {runtime.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => reconnectRuntime.mutate(runtime.id)}
                  disabled={reconnectRuntime.isPending}
                  className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg-soft disabled:opacity-50"
                  title="Reconnect"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                {runtime.id !== "local" && (
                  <button
                    onClick={() => removeRuntime.mutate(runtime.id)}
                    disabled={removeRuntime.isPending}
                    className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-sm text-fg-subtle">
            No runtimes configured
          </div>
        )}
      </div>
    </div>
  );
}

function PekoFolder() {
  const { data: dir, error } = useQuery({ queryKey: ["peko-home-dir"], queryFn: pekoHomeDir });
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold text-fg">Peko folder</h3>
      <p className="mt-0.5 text-xs text-fg-muted">
        Where the engine keeps your pekos, models, and keys.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code
          data-testid="peko-home-dir"
          className="min-w-0 flex-1 truncate rounded-lg bg-surface-sunken px-3 py-2 text-xs text-fg-soft"
        >
          {dir ?? (error ? "Unknown" : "…")}
        </code>
        <button
          type="button"
          disabled={!dir}
          onClick={() => dir && void revealItemInDir(dir)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-card px-3 py-2 text-xs font-medium text-fg-soft transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Show folder
        </button>
      </div>
    </div>
  );
}

function AdvancedSection() {
  return (
    <div className="space-y-4">
      <PekoFolder />
      <StoredKeys />
      <div className={CARD}>
        <Runtimes />
      </div>
    </div>
  );
}

const LINKS = [
  {
    label: "Getting started",
    url: "https://github.com/ConekoAI/peko-runtime/blob/master/docs/getting-started/GETTING_STARTED.md",
  },
  { label: "Report a problem", url: "https://github.com/ConekoAI/peko-desktop/issues" },
];

function AboutSection() {
  const { data: appVersion } = useQuery({ queryKey: ["app-version"], queryFn: getVersion });
  const { data: engine } = useEngineStatus();
  const engineVersion = engine?.kind === "running" ? engine.version : null;

  function handleReplayOnboarding() {
    localStorage.removeItem(ONBOARDING_KEY);
    window.dispatchEvent(new Event(REPLAY_EVENT));
  }

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand">
            <span className="text-xl font-bold text-brand-fg">P</span>
          </div>
          <h3 className="text-lg font-bold text-fg">Peko</h3>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-fg-muted">App version</dt>
            <dd data-testid="app-version" className="font-medium text-fg">
              {appVersion ?? "…"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-muted">Engine version</dt>
            <dd data-testid="engine-version" className="font-medium text-fg">
              {engineVersion ?? (engine?.kind === "running" ? "…" : "Not running")}
            </dd>
          </div>
        </dl>
      </div>

      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-fg">Help</h3>
        <div className="flex flex-col items-start gap-1">
          {LINKS.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={() => void openUrl(link.url)}
              className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </button>
          ))}
        </div>
      </div>

      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-fg">Onboarding</h3>
        <p className="mb-3 text-xs text-fg-muted">
          Walk through connecting a model and creating a peko again.
        </p>
        <button
          type="button"
          onClick={handleReplayOnboarding}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-card px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
        >
          Replay onboarding
        </button>
      </div>
    </div>
  );
}

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "models", label: "Models", icon: Cpu },
  { id: "advanced", label: "Advanced", icon: Wrench },
  { id: "about", label: "About", icon: Info },
];

export default function Settings() {
  const [active, setActive] = useState<Section>("general");

  return (
    <div className="mx-auto flex max-w-4xl gap-6">
      <nav aria-label="Settings sections" className="w-44 shrink-0">
        <h2 className="mb-3 px-3 text-xl font-bold text-fg">Settings</h2>
        <div className="space-y-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              aria-current={active === id ? "page" : undefined}
              className={[
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active === id
                  ? "bg-brand-soft text-brand"
                  : "text-fg-soft hover:bg-surface-sunken",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 pt-11">
        {active === "general" && <GeneralSection />}
        {active === "models" && <ModelsSection />}
        {active === "advanced" && <AdvancedSection />}
        {active === "about" && <AboutSection />}
      </div>
    </div>
  );
}
