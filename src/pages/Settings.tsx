import { useState, useEffect, useMemo } from "react";
import {
  useSettings,
  useSetSetting,
  useCredential,
  useCredentialList,
  useSetCredential,
  useDeleteCredential,
  useTestCredential,
} from "../hooks/useSettings";
import { useRuntimes, useAddRuntime, useRemoveRuntime, useReconnectRuntime, useRenameRuntime, useOAuthConnect, startOAuthConnect } from "../hooks/useRuntimes";
import { useProviders } from "../hooks/useProviders";
import { getTheme, setTheme } from "../lib/theme";
import { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";
import AddProviderModal from "../components/modals/AddProviderModal";
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
  ExternalLink,
} from "lucide-react";
import type { RuntimeConnection } from "../types";

type Tab = "general" | "credentials" | "runtimes" | "about";

function GeneralTab() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    setThemeState(getTheme());
  }, []);

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

  const dataDir = settings?.find((s) => s.key === "app.data_dir")?.value ?? "";

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

      {/* T-107: the "Auto-start daemon on launch" panel was removed.
          The engine lifecycle is owned by the sidecar supervisor
          (ADR-043) and is not a desktop-user concern. Re-introducing
          it would surface operator wiring on the user-facing surface. */}

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
          ?.filter((s) => !["app.data_dir"].includes(s.key))
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
  // T-109b redesign: one row per provider (catalog ∪ vault) with the
  // full edit / test / remove controls inline. The previous design
  // had a fallback-pill row of static catalog defaults (OpenAI /
  // Anthropic / Kimi / Ollama / Azure / Google) that meant nothing
  // when the runtime hadn't returned providers yet, plus a single
  // shared input gated on a "selected" state — neither of which told
  // the user what they could actually do with an existing key.
  //
  // Each row owns its own API-key input and action buttons, so the
  // user can:
  //   • See every catalog entry that exists on disk, even without a
  //     key (so they can add one inline without going through the
  //     Add Provider modal first).
  //   • Update / test / remove a configured key directly on its row.
  //   • Spot orphan vault keys (vault entry, no catalog match) in a
  //     separate strip below — surfacing the `miniax`-style typos that
  //     the CLI now reports too (T-110 / peko-runtime#190).
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: credentials, isLoading: credentialsLoading } = useCredentialList();

  const credentialByProvider = useMemo(() => {
    const map = new Map<string, { hasKey: boolean; lastTested?: string }>();
    for (const c of credentials ?? []) {
      if (c.provider) {
        map.set(c.provider, { hasKey: c.hasKey, lastTested: c.lastTested });
      }
    }
    return map;
  }, [credentials]);

  // T-109b: "+ Add provider" opens the modal that drives the
  // runtime's `provider_templates` + `provider_add` IPC. Keeps the
  // desktop in sync with the CLI's `peko provider add --template`
  // / `--custom` surface (per-memory `cli-catalog-vs-vault-disagreement`).
  const [showAddProvider, setShowAddProvider] = useState(false);

  // Stable row order: configured first (alphabetical), then the rest
  // of the catalog (alphabetical). Orphans render separately below.
  const orderedRows = useMemo(() => {
    const list = (providers ?? []).slice();
    list.sort((a, b) => {
      const aHas = credentialByProvider.get(a.id)?.hasKey ? 1 : 0;
      const bHas = credentialByProvider.get(b.id)?.hasKey ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [providers, credentialByProvider]);

  const orphanIds = useMemo(() => {
    const catalogIds = new Set((providers ?? []).map((p) => p.id));
    return (credentials ?? [])
      .filter((c) => c.provider && c.hasKey && !catalogIds.has(c.provider))
      .map((c) => c.provider);
  }, [providers, credentials]);

  const isLoading = providersLoading || credentialsLoading;
  const hasAnyContent =
    orderedRows.length > 0 || orphanIds.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Provider Credentials
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Manage API keys for each provider. Keys are stored in the OS
              keychain by the runtime — the desktop never holds the secret
              beyond the save call.
            </p>
          </div>
          <button
            onClick={() => setShowAddProvider(true)}
            data-testid="open-add-provider-modal"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add provider
          </button>
        </div>

        {isLoading && !hasAnyContent && (
          <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading providers…
          </p>
        )}

        {!isLoading && !hasAnyContent && (
          <div
            data-testid="credentials-empty-state"
            className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center dark:border-slate-800"
          >
            <Key className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No providers configured yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a provider to start chatting. Built-in templates
              (Anthropic, OpenAI, Ollama, …) and fully custom endpoints
              are both supported.
            </p>
            <button
              onClick={() => setShowAddProvider(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add your first provider
            </button>
          </div>
        )}

        {hasAnyContent && (
          <div
            data-testid="credentials-rows"
            className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
          >
            {orderedRows.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                credential={credentialByProvider.get(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {orphanIds.length > 0 && (
        <div
          data-testid="credentials-orphans"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20"
        >
          <div className="mb-2 flex items-center gap-2">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Orphaned vault keys
            </h3>
          </div>
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
            These keys are stored in the keychain but no provider entry
            exists in the catalog. They were likely added via CLI
            (<code>peko credential set</code>) with a typo'd id. Clean up
            with <code>peko credential delete &lt;id&gt;</code>.
          </p>
          <ul className="space-y-1.5">
            {orphanIds.map((id) => (
              <OrphanRow key={id} providerId={id} />
            ))}
          </ul>
        </div>
      )}

      <AddProviderModal
        open={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        onSuccess={(id) => {
          // The new provider appears in the catalog via React Query
          // invalidation; nothing else to wire here.
          void id;
        }}
      />
    </div>
  );
}

/**
 * One row per catalog provider — name, status, inline API-key input,
 * and Test / Save / Delete buttons. The row is self-contained: there
 * is no parent "selected" state to keep in sync, so the user can
 * edit multiple providers without losing input on another.
 */
function ProviderRow({
  provider,
  credential,
}: {
  provider: {
    id: string;
    displayName: string;
    apiType: string;
    defaultModel: string;
    requiresKey: boolean;
    isLocal: boolean;
  };
  credential?: { hasKey: boolean; lastTested?: string };
}) {
  const [apiKey, setApiKey] = useState("");
  const setCred = useSetCredential();
  const deleteCred = useDeleteCredential();
  const testCred = useTestCredential();

  // Track which mutation just succeeded for *this* row so we can show
  // a transient confirmation without other rows' mutations stomping
  // on it.
  const [justSaved, setJustSaved] = useState(false);
  const [justDeleted, setJustDeleted] = useState(false);

  function handleSave() {
    if (!apiKey) return;
    setCred.mutate(
      { provider: provider.id, apiKey },
      {
        onSuccess: () => {
          setApiKey("");
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2500);
        },
      },
    );
  }

  function handleDelete() {
    deleteCred.mutate(provider.id, {
      onSuccess: () => {
        setJustDeleted(true);
        setTimeout(() => setJustDeleted(false), 2500);
      },
    });
  }

  const hasKey = credential?.hasKey ?? false;
  const showInput = provider.requiresKey && !provider.isLocal;
  const isPending = setCred.isPending || deleteCred.isPending;

  return (
    <div
      data-testid={`provider-row-${provider.id}`}
      className="bg-white px-4 py-3 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {provider.displayName}
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {provider.id}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {provider.apiType}
            </span>
            {hasKey ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <Check className="h-2.5 w-2.5" />
                Key set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                No key
              </span>
            )}
            {provider.defaultModel && (
              <span className="hidden font-mono text-[10px] text-slate-400 sm:inline dark:text-slate-500">
                {provider.defaultModel}
              </span>
            )}
          </div>
        </div>
      </div>

      {showInput && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? "•••••••• (leave blank to keep)" : "Enter API key…"}
            data-testid={`api-key-input-${provider.id}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey) handleSave();
            }}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <button
            onClick={handleSave}
            disabled={!apiKey || isPending}
            data-testid={`save-key-${provider.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {hasKey ? "Update" : "Save"}
          </button>
          {hasKey && (
            <button
              onClick={() => testCred.mutate(provider.id)}
              disabled={isPending || testCred.isPending}
              data-testid={`test-key-${provider.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {testCred.isPending && testCred.variables === provider.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <TestTube className="h-3 w-3" />
              )}
              Test
            </button>
          )}
          {hasKey && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              data-testid={`delete-key-${provider.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-400"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      )}

      {(justSaved || justDeleted) && (
        <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          {justSaved ? "✓ Saved" : "✓ Removed"}
        </p>
      )}

      {testCred.data && testCred.variables === provider.id && (
        <p
          data-testid={`credential-test-result-${provider.id}`}
          className={[
            "mt-1.5 text-[11px]",
            testCred.data.success
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          ].join(" ")}
        >
          {testCred.data.success ? (
            <>
              ✓ Connected
              {testCred.data.modelUsed
                ? ` via ${testCred.data.modelUsed} (${testCred.data.latencyMs}ms, ~1 token billed)`
                : ` (${testCred.data.latencyMs}ms)`}
            </>
          ) : (
            <>
              ✗ {testCred.data.message || "Connection failed"}
              {testCred.data.httpStatus !== null
                ? ` (HTTP ${testCred.data.httpStatus}, ${testCred.data.latencyMs}ms)`
                : ` (${testCred.data.latencyMs}ms)`}
            </>
          )}
        </p>
      )}

      {setCred.error && (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
          {setCred.error instanceof Error
            ? setCred.error.message
            : String(setCred.error)}
        </p>
      )}
    </div>
  );
}

/**
 * One orphan row — a keychain entry with no catalog match. Renders
 * id + lastTested + a delete button. Per-memory
 * `cli-catalog-vs-vault-disagreement`, the desktop and CLI now both
 * surface these so the user can clean up typo'd vault entries.
 */
function OrphanRow({ providerId }: { providerId: string }) {
  const { data: credential } = useCredential(providerId);
  const deleteCred = useDeleteCredential();

  return (
    <li
      data-testid={`orphan-row-${providerId}`}
      className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-1.5 dark:border-amber-900 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-medium text-amber-900 dark:text-amber-200">
          {providerId}
        </span>
        {credential?.lastTested && (
          <span className="text-[10px] text-amber-700 dark:text-amber-400">
            tested {new Date(credential.lastTested).toLocaleString()}
          </span>
        )}
      </div>
      <button
        onClick={() => deleteCred.mutate(providerId)}
        disabled={deleteCred.isPending}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
        Delete
      </button>
    </li>
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
            Sign in with PekoHub
          </button>
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
          Reopen the onboarding overlay (pick provider → paste key → test →
          create principal). Useful for showing a teammate the flow without
          wiping the profile.
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
      {active === "runtimes" && <RuntimesTab />}
      {active === "about" && <AboutTab />}
    </div>
  );
}
