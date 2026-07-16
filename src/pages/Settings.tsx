import { useState, useEffect, useMemo } from "react";
import {
  useSettings,
  useSetSetting,
  useCredential,
  useDeleteCredential,
  useGenericCredentialList,
  useSetGenericCredential,
  useDeleteCredentialById,
  useTestCredentialById,
  useCredentialMaterial,
} from "../hooks/useSettings";
import { useRuntimes, useAddRuntime, useRemoveRuntime, useReconnectRuntime, useRenameRuntime, useOAuthConnect, startOAuthConnect } from "../hooks/useRuntimes";
import { useProviders, useUpdateProvider, useRemoveProvider, useSetDefaultProvider } from "../hooks/useProviders";
import { useBinding, useSetBinding, useDeleteBinding, useTestBindingRotation } from "../hooks/useBindings";
import { getTheme, setTheme } from "../lib/theme";
import { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";
import AddProviderModal from "../components/modals/AddProviderModal";
import EditProviderModal from "../components/modals/EditProviderModal";
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
  Star,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";
import type { RuntimeConnection, ProviderInfo, CredentialDetail, RotationBinding, CredentialKind } from "../types";

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
          // Hide operator-only keys from the user-facing surface.
          //   • `app.data_dir` lives in the dedicated Data Directory
          //     panel above (read-only display).
          //   • `daemon.autostart` is owned by the sidecar supervisor
          //     lifecycle (ADR-043) — there is no user-meaningful
          //     toggle for it; the runtime doesn't even read it.
          //     Surfacing it as a generic "Other settings" row let
          //     the user toggle a no-op and looked like a broken
          //     setting.
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
  // RP6 redesign: accordion of all catalog providers. Each provider
  // can hold multiple generic credentials under namespace
  // `provider:<id>` and one rotation binding at
  // `provider:<id>:default`. Catalog-level actions (edit / remove /
  // set-default / enabled) live in the card header; credential and
  // binding management lives in the expandable body.
  const { data: providers, isLoading: providersLoading, isError: providersError } =
    useProviders();
  const { data: allCreds, isLoading: credsLoading } = useGenericCredentialList();

  const credsByNamespace = useMemo(() => {
    const map = new Map<string, CredentialDetail[]>();
    for (const c of allCreds ?? []) {
      const list = map.get(c.namespace) ?? [];
      list.push(c);
      map.set(c.namespace, list);
    }
    return map;
  }, [allCreds]);

  const catalogAvailable =
    !providersLoading && !providersError && Array.isArray(providers);
  const catalogIds = useMemo(
    () => new Set((providers ?? []).map((p) => p.id)),
    [providers],
  );
  const orphanIds = useMemo(() => {
    if (!catalogAvailable) return [];
    const out: string[] = [];
    for (const c of allCreds ?? []) {
      if (!c.namespace.startsWith("provider:")) continue;
      const id = c.namespace.slice("provider:".length);
      if (!catalogIds.has(id) && !out.includes(id)) {
        out.push(id);
      }
    }
    return out.sort();
  }, [allCreds, catalogAvailable, catalogIds]);

  const isLoading = providersLoading || credsLoading;
  const hasAnyContent = (providers?.length ?? 0) > 0 || orphanIds.length > 0;

  const [showAddProvider, setShowAddProvider] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Provider Credentials
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Manage API keys, rotation bindings, and provider catalog
              entries. Keys are stored in the OS keychain by the runtime.
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
              Add a provider to start chatting. Built-in templates and
              custom endpoints are both supported.
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

        {catalogAvailable && (providers?.length ?? 0) > 0 && (
          <div
            data-testid="credentials-rows"
            className="max-h-[60vh] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
          >
            {(providers ?? []).map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                credentials={credsByNamespace.get(`provider:${p.id}`) ?? []}
              />
            ))}
          </div>
        )}
      </div>

      {!catalogAvailable && !providersLoading && (
        <div
          data-testid="credentials-catalog-unavailable"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20"
        >
          <div className="mb-1 flex items-center gap-2">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Provider catalog unavailable
            </h3>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Couldn&apos;t load the provider catalog from the daemon, so
            we can&apos;t tell which vault keys are in use. Check that
            the daemon is running (<code>peko daemon status</code>) and
            reload this tab.
          </p>
        </div>
      )}

      {catalogAvailable && orphanIds.length > 0 && (
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
        onSuccess={() => {}}
      />
    </div>
  );
}

/**
 * Accordion card for one catalog provider. Header shows identity,
 * enabled toggle, default-provider star, edit/remove actions, and an
 * expand chevron. Body shows stored credentials, an add-credential
 * form, and the default rotation binding editor.
 */
function ProviderCard({
  provider,
  credentials,
}: {
  provider: ProviderInfo;
  credentials: CredentialDetail[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const updateProvider = useUpdateProvider();
  const removeProvider = useRemoveProvider();
  const setDefault = useSetDefaultProvider();

  const hasKey = credentials.some((c) => c.hasKey);
  const isDefault = provider.isDefault ?? false;

  function handleToggleEnabled() {
    updateProvider.mutate({ id: provider.id, enabled: !provider.enabled });
  }

  function handleSetDefault() {
    setDefault.mutate({ provider: provider.id });
  }

  function handleRemove() {
    if (confirm(`Remove provider "${provider.displayName}" from the catalog?`)) {
      removeProvider.mutate(provider.id);
    }
  }

  return (
    <div data-testid={`provider-row-${provider.id}`} className="bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "truncate text-sm font-medium",
                provider.enabled
                  ? "text-slate-800 dark:text-slate-100"
                  : "text-slate-400 dark:text-slate-500",
              ].join(" ")}
            >
              {provider.displayName}
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {provider.id}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {provider.apiType}
            </span>
            {!provider.enabled && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Disabled
              </span>
            )}
            {hasKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <Check className="h-2.5 w-2.5" />
                Key set
              </span>
            )}
            {isDefault && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {provider.requiresKey && !hasKey && (
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400"
            >
              Add key
            </button>
          )}
          <button
            onClick={handleSetDefault}
            title="Set as default"
            className={[
              "rounded p-1.5 transition-colors",
              isDefault ? "text-amber-500" : "text-slate-400 hover:text-amber-500",
            ].join(" ")}
          >
            <Star className={isDefault ? "h-3.5 w-3.5 fill-amber-500" : "h-3.5 w-3.5"} />
          </button>
          <button
            onClick={() => setShowEdit(true)}
            title="Edit"
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleRemove}
            title="Remove"
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <label className="ml-1 flex cursor-pointer items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={handleToggleEnabled}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Enabled
          </label>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <CredentialList credentials={credentials} />
          <AddCredentialForm providerId={provider.id} />
          <BindingPanel providerId={provider.id} />
        </div>
      )}

      {showEdit && (
        <EditProviderModal open provider={provider} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}

function CredentialList({
  credentials,
}: {
  credentials: CredentialDetail[];
}) {
  const deleteCred = useDeleteCredentialById();
  const testCred = useTestCredentialById();

  return (
    <div className="mb-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Keys
      </h4>
      {credentials.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No keys stored for this provider.
        </p>
      ) : (
        <ul className="space-y-2">
          {credentials.map((c) => (
            <li
              key={c.id}
              data-testid={`credential-row-${c.id}`}
              className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-800 dark:text-slate-200">
                    {c.name}
                  </span>
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {c.kind}
                  </span>
                  {c.lastTestedAt && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {c.lastTestedOk ? "✓" : "✗"} {new Date(c.lastTestedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => testCred.mutate(c.id)}
                    disabled={testCred.isPending && testCred.variables === c.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {testCred.isPending && testCred.variables === c.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <TestTube className="h-3 w-3" />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => deleteCred.mutate(c.id)}
                    disabled={deleteCred.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
              <RevealButton id={c.id} />
            </li>
          ))}
        </ul>
      )}
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

function AddCredentialForm({ providerId }: { providerId: string }) {
  const setCred = useSetGenericCredential();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CredentialKind>("api_key");
  const [material, setMaterial] = useState("");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !material.trim()) return;
    setCred.mutate(
      {
        namespace: `provider:${providerId}`,
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
    <form
      data-testid="add-credential-form"
      onSubmit={handleSave}
      className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
    >
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Add key
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-[8rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
          {setCred.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>
    </form>
  );
}

function BindingPanel({ providerId }: { providerId: string }) {
  const slotKey = `provider:${providerId}:default`;
  const { data: binding } = useBinding(slotKey);
  const setBinding = useSetBinding();
  const deleteBinding = useDeleteBinding();
  const testRotation = useTestBindingRotation();

  const [strategy, setStrategy] = useState<RotationBinding["strategy"]>("round_robin");
  const [orderText, setOrderText] = useState("");

  useEffect(() => {
    if (binding) {
      setStrategy(binding.strategy);
      setOrderText(binding.order.join(", "));
    } else {
      setStrategy("round_robin");
      setOrderText("");
    }
  }, [binding]);

  function handleSave() {
    const order = orderText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setBinding.mutate({ key: slotKey, strategy, order });
  }

  return (
    <div data-testid="rotation-binding-panel" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Rotation binding
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as RotationBinding["strategy"])}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        >
          <option value="round_robin">round_robin</option>
          <option value="last_resort">last_resort</option>
          <option value="random">random</option>
        </select>
        <input
          type="text"
          value={orderText}
          onChange={(e) => setOrderText(e.target.value)}
          placeholder="Credential ids, comma-separated"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={setBinding.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {setBinding.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save binding
        </button>
        {binding && (
          <button
            onClick={() => deleteBinding.mutate(slotKey)}
            disabled={deleteBinding.isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Delete
          </button>
        )}
        <button
          onClick={() => testRotation.mutate(slotKey)}
          disabled={testRotation.isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {testRotation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
          Test rotation
        </button>
      </div>
      {testRotation.data && Array.isArray(testRotation.data) && (
        <ul className="mt-2 space-y-1">
          {testRotation.data.map((r, i) => (
            <li
              key={i}
              className={[
                "text-xs",
                r.success
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              ].join(" ")}
            >
              {r.id}: {r.success ? "ok" : r.message}
            </li>
          ))}
        </ul>
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
