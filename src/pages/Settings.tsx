import { useState } from "react";
import {
  useSettings,
  useSetSetting,
  useGenericCredentialList,
  useSetGenericCredential,
  useDeleteCredentialById,
  useCredentialMaterial,
} from "../hooks/useSettings";
import {
  useModels,
  useUpdateModel,
  useRemoveModel,
  useTestModel,
} from "../hooks/useModels";
import { useRuntimes, useAddRuntime, useRemoveRuntime, useReconnectRuntime, useRenameRuntime, useOAuthConnect, usePekohubLogout, usePekohubBundle, startOAuthConnect } from "../hooks/useRuntimes";
import { setTheme } from "../lib/theme";
import { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";
import AddModelModal from "../components/modals/AddModelModal";
import EditModelModal from "../components/modals/EditModelModal";
import {
  Save,
  Key,
  FileJson,
  Info,
  Check,
  Trash2,
  TestTube,
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
  LogIn,
  LogOut,
  ExternalLink,
  Cpu,
  Eye,
  EyeOff,
} from "lucide-react";
import type { RuntimeConnection, CredentialDetail, CredentialKind, ModelSummary } from "../types";

type Tab = "general" | "credentials" | "models" | "runtimes" | "about";

function GeneralTab() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataDir = settings?.find((s) => s.key === "app.data_dir")?.value ?? "";

  function handleChange(key: string, value: string) {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(key: string) {
    const value = localValues[key];
    if (value !== undefined) {
      setSetting.mutate({ key, value });
    }
  }

  function handleThemeChange(next: "light" | "dark" | "system") {
    setThemeState(next);
    setTheme(next);
  }

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Appearance</h3>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((t) => {
            const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
            return (
              <button
                key={t}
                onClick={() => handleThemeChange(t)}
                className={[
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  theme === t
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Data Directory */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Data Directory</h3>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
            <FolderOpen className="h-4 w-4 text-slate-400" />
            <span className="truncate">{dataDir || "Default"}</span>
          </div>
        </div>
      </div>

      {/* Other settings */}
      <div className="space-y-4">
        {settings
          ?.filter((s) => !["app.data_dir", "daemon.autostart"].includes(s.key))
          .map((s) => (
            <div
              key={s.key}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {s.key}
              </label>
              {s.description && (
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-500">{s.description}</p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  defaultValue={s.value}
                  onChange={(e) => handleChange(s.key, e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
                <button
                  onClick={() => handleSave(s.key)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function CredentialsTab() {
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
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Credential Vault
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Generic secrets stored by the runtime. Models and other tools
            reference them by id.
          </p>
        </div>

        <form
          data-testid="add-credential-form"
          onSubmit={handleSave}
          className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Add credential
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="Namespace"
              className="min-w-[6rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="min-w-[6rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CredentialKind)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="api_key">api_key</option>
              <option value="bearer_token">bearer_token</option>
              <option value="oauth_token">oauth_token</option>
              <option value="basic_auth">basic_auth</option>
              <option value="private_key">private_key</option>
              <option value="generic_secret">generic_secret</option>
            </select>
            <input
              type="password"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="Secret"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="submit"
              disabled={!name.trim() || !material.trim() || setCred.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {setCred.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </button>
          </div>
        </form>

        {isLoading && (
          <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading credentials…
          </p>
        )}

        {!isLoading && (credentials?.length ?? 0) === 0 && (
          <div
            data-testid="credentials-empty-state"
            className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center dark:border-slate-800"
          >
            <Key className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No credentials stored yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a generic secret above, or link one while adding a model.
            </p>
          </div>
        )}

        {!isLoading && (credentials?.length ?? 0) > 0 && (
          <div
            data-testid="credentials-rows"
            className="max-h-[60vh] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
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
      className="bg-white p-3 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-800 dark:text-slate-200">
            {credential.namespace}/{credential.name}
          </span>
          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {credential.kind}
          </span>
          {credential.lastTestedAt && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              {credential.lastTestedOk ? "✓" : "✗"}{" "}
              {new Date(credential.lastTestedAt).toLocaleString()}
            </span>
          )}
        </div>
        <button
          onClick={() => deleteCred.mutate(credential.id)}
          disabled={deleteCred.isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-400"
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
        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
      >
        {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {open ? "Hide secret" : "Reveal secret"}
      </button>
      {open && (
        <div className="mt-1">
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
          ) : (
            <input
              type="text"
              readOnly
              value={data ?? ""}
              className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModelsTab() {
  const { data: models, isLoading, isError } = useModels();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Configured Models
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Endpoint configurations the runtime uses for inference.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            data-testid="open-add-model-modal"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add model
          </button>
        </div>

        {isLoading && (
          <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading models…
          </p>
        )}

        {!isLoading && !isError && (models?.length ?? 0) === 0 && (
          <div
            data-testid="models-empty-state"
            className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center dark:border-slate-800"
          >
            <Cpu className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No models configured yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a model from a built-in preset or a custom endpoint.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add your first model
            </button>
          </div>
        )}

        {!isLoading && !isError && (models?.length ?? 0) > 0 && (
          <div
            data-testid="models-rows"
            className="max-h-[60vh] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
          >
            {models?.map((m) => <ModelCard key={m.id} model={m} />)}
          </div>
        )}

        {isError && (
          <div
            data-testid="models-catalog-unavailable"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20"
          >
            <div className="mb-1 flex items-center gap-2">
              <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Model catalog unavailable
              </h3>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">
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

function ModelCard({ model }: { model: ModelSummary }) {
  const [showEdit, setShowEdit] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const updateModel = useUpdateModel();
  const removeModel = useRemoveModel();
  const testModel = useTestModel();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function handleToggleEnabled() {
    updateModel.mutate({ id: model.id, enabled: !model.enabled });
  }

  function handleTest() {
    testModel.mutate(model.id, {
      onSuccess: (result) => {
        setFeedback({
          ok: result.ok,
          text: result.ok
            ? `Test passed${result.modelUsed ? ` · ${result.modelUsed}` : ""}`
            : result.message,
        });
      },
      onError: (err) => {
        setFeedback({
          ok: false,
          text: err instanceof Error ? err.message : "Test failed",
        });
      },
    });
  }

  function handleConfirmRemove() {
    removeModel.mutate(model.id, {
      onSuccess: () => setConfirmingRemove(false),
      onError: () => setConfirmingRemove(false),
    });
  }

  return (
    <div data-testid={`model-row-${model.id}`} className="bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "truncate text-sm font-medium",
                model.enabled
                  ? "text-slate-800 dark:text-slate-100"
                  : "text-slate-400 dark:text-slate-500",
              ].join(" ")}
            >
              {model.displayName}
            </span>
            <span
              title="API format"
              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              {model.apiFormat}
            </span>
            {!model.enabled && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Disabled
              </span>
            )}
            {model.requiresKey && !model.credentialId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                No credential
              </span>
            )}
            {model.credentialId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <Check className="h-2.5 w-2.5" />
                Credential set
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-mono">{model.modelId}</span>
            <span>{model.baseUrl}</span>
            {model.contextWindow !== undefined && (
              <span>{model.contextWindow.toLocaleString()} ctx</span>
            )}
            {model.maxOutputTokens !== undefined && (
              <span>{model.maxOutputTokens.toLocaleString()} out</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTest}
            disabled={testModel.isPending}
            title="Test model"
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            {testModel.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setShowEdit(true)}
            title="Edit"
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          {confirmingRemove ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Remove?</span>
              <button
                onClick={handleConfirmRemove}
                disabled={removeModel.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {removeModel.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Confirm
              </button>
              <button
                onClick={() => setConfirmingRemove(false)}
                disabled={removeModel.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              title="Remove"
              className="rounded p-1.5 text-slate-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <label className="ml-1 flex cursor-pointer items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={model.enabled}
              onChange={handleToggleEnabled}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Enabled
          </label>
        </div>
      </div>

      {feedback && (
        <div
          className={[
            "px-4 pb-2 text-[11px]",
            feedback.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          ].join(" ")}
        >
          {feedback.ok ? "✓ " : "✗ "}
          {feedback.text}
        </div>
      )}

      {showEdit && (
        <EditModelModal open model={model} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}

function RuntimesTab() {
  const { data: settings } = useSettings();
  const { data: runtimes, isLoading } = useRuntimes();
  const addRuntime = useAddRuntime();
  const removeRuntime = useRemoveRuntime();
  const reconnectRuntime = useReconnectRuntime();
  const renameRuntime = useRenameRuntime();
  const oauthConnect = useOAuthConnect();
  const pekohubLogout = usePekohubLogout();
  const { data: pekohubBundle } = usePekohubBundle();
  const pekohubSignedIn = pekohubBundle !== null && pekohubBundle !== undefined;

  const [showAdd, setShowAdd] = useState(false);
  const [newRuntimeId, setNewRuntimeId] = useState("");
  const [newRuntimeName, setNewRuntimeName] = useState("");
  const [newRuntimeUrl, setNewRuntimeUrl] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  // OAuth flow state
  const [showOAuth, setShowOAuth] = useState(false);
  const [oauthCode, setOauthCode] = useState("");
  const [oauthState, setOauthState] = useState("");
  const [oauthError, setOauthError] = useState<string | null>(null);

  const pekohubBaseUrl =
    settings?.find((s) => s.key === "pekohub.base_url")?.value ?? "https://pekohub.org";
  const oauthRedirectUri =
    settings?.find((s) => s.key === "pekohub.oauth_redirect_uri")?.value ?? "http://localhost:0/callback";
  const oauthScope =
    settings?.find((s) => s.key === "pekohub.oauth_scope")?.value ?? "runtimes:read";

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

  async function handleStartOAuth() {
    setOauthError(null);
    setOauthCode("");
    setOauthState("");
    try {
      await startOAuthConnect({
        baseUrl: pekohubBaseUrl,
        redirectUri: oauthRedirectUri,
        scope: oauthScope,
      });
      setShowOAuth(true);
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "Failed to start OAuth flow");
    }
  }

  function handleExchangeCode() {
    setOauthError(null);
    if (!oauthCode.trim() || !oauthState.trim()) return;
    oauthConnect.mutate(
      { code: oauthCode.trim(), state: oauthState.trim() },
      {
        onSuccess: (result) => {
          setShowOAuth(false);
          setOauthCode("");
          setOauthState("");
          if (result.added === 0) {
            setOauthError("No runtimes found for this account.");
          }
        },
        onError: (err) => {
          setOauthError(err instanceof Error ? err.message : "OAuth exchange failed");
        },
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Connected Runtimes</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manage local and remote runtimes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartOAuth}
            disabled={oauthConnect.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {oauthConnect.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {pekohubSignedIn ? "Re-link PekoHub" : "Sign in with PekoHub"}
          </button>
          {pekohubSignedIn && (
            <button
              onClick={() => pekohubLogout.mutate()}
              disabled={pekohubLogout.isPending}
              data-testid="pekohub-signout"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              title="Forget PekoHub OAuth bundle"
            >
              {pekohubLogout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign out
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <Plus className="h-4 w-4" />
            Add Remote
          </button>
        </div>
      </div>

      {/* OAuth flow panel */}
      {showOAuth && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h4 className="mb-2 text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            Complete Sign-In
          </h4>
          <p className="mb-3 text-xs text-indigo-700 dark:text-indigo-300">
            Your browser was opened. After authorizing, copy the authorization code from the
            redirect URL and paste it below.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-indigo-700 dark:text-indigo-300">
                Authorization Code
              </label>
              <input
                type="text"
                value={oauthCode}
                onChange={(e) => setOauthCode(e.target.value)}
                placeholder="Paste code here..."
                className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-indigo-700 dark:text-indigo-300">
                State
              </label>
              <input
                type="text"
                value={oauthState}
                onChange={(e) => setOauthState(e.target.value)}
                placeholder="Paste state parameter..."
                className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExchangeCode}
                disabled={oauthConnect.isPending || !oauthCode.trim() || !oauthState.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {oauthConnect.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Exchange & Connect
              </button>
              <button
                onClick={() => {
                  setShowOAuth(false);
                  setOauthCode("");
                  setOauthState("");
                  setOauthError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>
            {oauthError && (
              <p className="text-xs text-red-600 dark:text-red-400">{oauthError}</p>
            )}
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAdd && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Add Remote Runtime</h4>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Runtime ID</label>
              <input
                type="text"
                value={newRuntimeId}
                onChange={(e) => setNewRuntimeId(e.target.value)}
                placeholder="e.g. did:key:z6Mk..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Display Name</label>
              <input
                type="text"
                value={newRuntimeName}
                onChange={(e) => setNewRuntimeName(e.target.value)}
                placeholder="e.g. Home Server"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                PekoHub URL (optional)
              </label>
              <input
                type="text"
                value={newRuntimeUrl}
                onChange={(e) => setNewRuntimeUrl(e.target.value)}
                placeholder="https://pekohub.org/api"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={addRuntime.isPending || !newRuntimeId.trim() || !newRuntimeName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {addRuntime.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
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
          <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading runtimes...
          </div>
        ) : runtimes && runtimes.length > 0 ? (
          runtimes.map((runtime) => (
            <div
              key={runtime.id}
              className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-3">
                <div
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    runtime.connectionType === "local"
                      ? "bg-slate-100 dark:bg-slate-800"
                      : "bg-indigo-50 dark:bg-indigo-950/30",
                  ].join(" ")}
                >
                  {runtime.connectionType === "local" ? (
                    <MonitorIcon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  ) : (
                    <Globe className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
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
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <button
                        onClick={() => commitRename(runtime.id)}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {runtime.name}
                      </span>
                      <button
                        onClick={() => startRename(runtime)}
                        className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-300"
                        title="Rename"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="capitalize">{runtime.connectionType}</span>
                    <span>·</span>
                    <span
                      className={[
                        runtime.status === "connected"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : runtime.status === "error"
                            ? "text-red-600 dark:text-red-400"
                            : runtime.status === "connecting"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-slate-400 dark:text-slate-500",
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
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  title="Reconnect"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                {runtime.id !== "local" && (
                  <button
                    onClick={() => removeRuntime.mutate(runtime.id)}
                    disabled={removeRuntime.isPending}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
            No runtimes configured
          </div>
        )}
      </div>
    </div>
  );
}

function AboutTab() {
  // T-105: escape hatch — clear the dismiss flag and broadcast so the
  // FirstRunWalkthrough overlay re-shows. The overlay listens for
  // REPLAY_EVENT and clears its own in-session `dismissed` state.
  function handleReplayOnboarding() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(ONBOARDING_KEY);
    window.dispatchEvent(new Event(REPLAY_EVENT));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600">
            <span className="text-xl font-bold text-white">P</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Peko Desktop</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Tauri v2 + React 19</p>
          </div>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Version</dt>
            <dd className="font-medium text-slate-900 dark:text-white">0.1.0</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">React</dt>
            <dd className="font-medium text-slate-900 dark:text-white">19</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Tauri</dt>
            <dd className="font-medium text-slate-900 dark:text-white">2</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Tailwind CSS</dt>
            <dd className="font-medium text-slate-900 dark:text-white">4</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Documentation</h3>
        <a
          href="https://github.com/peko-bot/peko"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-emerald-600 hover:underline dark:text-emerald-400"
        >
          GitHub Repository →
        </a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">First-run walkthrough</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Reopen the onboarding overlay (add model → test → create principal).
          Useful for showing a teammate the flow without wiping the profile.
        </p>
        <button
          type="button"
          onClick={handleReplayOnboarding}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Replay onboarding
        </button>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: FileJson },
  { id: "credentials", label: "Credentials", icon: Key },
  { id: "models", label: "Models", icon: Cpu },
  { id: "runtimes", label: "Runtimes", icon: Globe },
  { id: "about", label: "About", icon: Info },
];

export default function Settings() {
  const [active, setActive] = useState<Tab>("general");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Configure your Peko environment</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active === tab.id
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {active === "general" && <GeneralTab />}
      {active === "credentials" && <CredentialsTab />}
      {active === "models" && <ModelsTab />}
      {active === "runtimes" && <RuntimesTab />}
      {active === "about" && <AboutTab />}
    </div>
  );
}
