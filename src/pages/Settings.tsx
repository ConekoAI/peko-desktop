import { useState, useEffect } from "react";
import {
  useSettings,
  useSetSetting,
  useCredential,
  useSetCredential,
  useDeleteCredential,
  useTestCredential,
} from "../hooks/useSettings";
import { useRuntimes, useAddRuntime, useRemoveRuntime, useReconnectRuntime, useRenameRuntime, useOAuthConnect, startOAuthConnect } from "../hooks/useRuntimes";
import { useProviders } from "../hooks/useProviders";
import {
  useEngineStatus,
  useEngineDiagnostics,
  useEngineRestart,
  useEngineStateChanged,
} from "../hooks/useEngine";
import {
  engineStateLabel,
  engineStateSubtitle,
  engineStateTone,
} from "../lib/engine-helpers";
import { getTheme, setTheme } from "../lib/theme";
import {
  resolveLogLevel,
  resolveProviderItems,
  LOG_LEVELS,
  type LogLevel,
} from "../lib/settings-helpers";
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
  AlertCircle,
  RotateCcw,
  Activity,
} from "lucide-react";
import type { RuntimeConnection, EngineDiagnostics } from "../types";

type Tab = "general" | "daemon" | "credentials" | "runtimes" | "about";

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

  const autoStart = settings?.find((s) => s.key === "daemon.autostart")?.value ?? "false";
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

      {/* Auto-start */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Daemon</h3>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={autoStart === "true"}
            onChange={(e) =>
              setSetting.mutate({ key: "daemon.autostart", value: String(e.target.checked) })
            }
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-700"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Auto-start daemon on launch</span>
        </label>
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
          ?.filter((s) => !["daemon.autostart", "app.data_dir"].includes(s.key))
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

function DiagnosticsPanel({
  diag,
  onRestart,
  isRestarting,
  borrowed,
}: {
  diag: EngineDiagnostics | undefined;
  onRestart: () => void;
  isRestarting: boolean;
  /** `true` when the engine is adopted from a foreign daemon (CLI
   *  `peko daemon start` or another desktop). Restart is disabled
   *  in that case — the engine is not the desktop's to cycle. */
  borrowed: boolean;
}) {
  // The supervisor pushes the most recent log line via stderr;
  // rendering the ring buffer here lets a developer eyeball what
  // the engine is doing without leaving the app.
  const rows: { label: string; value: string }[] = [];

  if (diag) {
    rows.push({ label: "State", value: engineStateLabel(diag.state) });
    if (diag.pid != null) rows.push({ label: "PID", value: String(diag.pid) });
    if (diag.version) rows.push({ label: "Version", value: diag.version });
    if (diag.expected_version) {
      rows.push({ label: "Expected version", value: diag.expected_version });
      rows.push({
        label: "Match",
        value:
          diag.version_matches === null
            ? "unknown (engine still starting)"
            : diag.version_matches
              ? "yes"
              : "MISMATCH",
      });
    }
    rows.push({ label: "Uptime", value: `${diag.uptime_secs}s` });
    rows.push({ label: "Lockfile", value: diag.lockfile_path });
    rows.push({ label: "Socket", value: diag.socket_path });
    rows.push({ label: "Restarts", value: String(diag.restart_count) });
    // `mode` distinguishes "sidecar" (this desktop spawned it) from
    // "headless" (adopted from a CLI daemon). Useful confirmation
    // when a user opens the panel to ask "whose engine am I
    // looking at?"
    if (diag.mode) {
      rows.push({ label: "Launch mode", value: diag.mode });
    }
    if (diag.last_error) rows.push({ label: "Last error", value: diag.last_error });
  }

  return (
    <div className="space-y-3">
      {borrowed && (
        <div
          role="status"
          data-testid="diagnostics-borrowed-banner"
          className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Borrowed from a CLI daemon</p>
            <p className="mt-0.5 text-[11px] text-indigo-700 dark:text-indigo-300">
              The desktop did not spawn this engine. It picked up a
              daemon that was already running on the IPC socket.
              Restart is disabled to avoid killing a process the
              desktop does not own — run{" "}
              <code className="rounded bg-indigo-100 px-1 dark:bg-indigo-950/50">
                peko daemon stop &amp;&amp; peko daemon start
              </code>{" "}
              from the terminal, or close and reopen this window to
              spawn a fresh sidecar.
            </p>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1 dark:border-slate-800">
            <dt className="shrink-0 text-slate-500 dark:text-slate-400">
              {r.label}
            </dt>
            <dd
              className={[
                "truncate text-right font-mono",
                r.label === "Match" && r.value === "MISMATCH"
                  ? "font-semibold text-amber-700 dark:text-amber-300"
                  : "text-slate-700 dark:text-slate-300",
              ].join(" ")}
              title={r.value}
            >
              {r.value}
            </dd>
          </div>
        ))}
        {(!diag || rows.length === 0) && (
          <div className="text-xs italic text-slate-400 dark:text-slate-500">
            {diag ? "No diagnostics fields available." : "Loading diagnostics…"}
          </div>
        )}
      </dl>

      {diag && diag.log_ring.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
          <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
            Recent log ({diag.log_ring.length} lines)
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-slate-600 dark:text-slate-400">
            {diag.log_ring.join("\n")}
          </pre>
        </details>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onRestart}
          disabled={isRestarting || borrowed}
          title={
            borrowed
              ? "Restart is disabled while the engine is borrowed from a CLI daemon. Run `peko daemon stop && peko daemon start` from the terminal, or close and reopen this window to spawn a fresh sidecar."
              : undefined
          }
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {isRestarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Restart engine
        </button>
        {!borrowed && (
          <p className="text-[11px] italic text-slate-500 dark:text-slate-400">
            Restarts the bundled engine. Normally you should just close
            and reopen the desktop.
          </p>
        )}
      </div>
    </div>
  );
}

function DaemonTab() {
  // ADR-043 §adoption: the engine is owned by the sidecar
  // supervisor. The Daemon tab no longer exposes Start/Stop/Restart
  // — those happen automatically at app launch and on unexpected
  // exit. The diagnostics panel is reachable directly from this tab
  // (no two-click arm pattern anymore — that pattern only made
  // sense for a "happy path decoration" surface, which the engine
  // status is no longer). When the engine is adopted from a
  // foreign daemon the panel renders a "borrowed from CLI daemon"
  // banner and disables the Restart button.
  const { data: engine, isLoading } = useEngineStatus();
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const diag = useEngineDiagnostics();
  const restart = useEngineRestart();

  // Refresh diagnostics whenever the engine reports a state
  // transition — keeps the panel in sync without polling.
  const { state: lastTransition } = useEngineStateChanged();
  useEffect(() => {
    if (lastTransition) {
      diag.refetch();
    }
    // We intentionally exclude `diag.refetch` from the deps: React
    // Query's QueryClient returns a stable function reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTransition]);

  const currentLogLevel = resolveLogLevel(settings);

  function handleLogLevelChange(level: LogLevel) {
    if (level === currentLogLevel) return;
    setSetting.mutate({ key: "daemon.log_level", value: level });
  }

  const tone = engineStateTone(engine);
  const subtitle = engineStateSubtitle(engine);
  const label = engineStateLabel(engine);
  // `owns_process === false` means the supervisor adopted an
  // already-running daemon (typically `peko daemon start` from the
  // CLI). The engine is up and the chat works, but the desktop
  // doesn't own the process — Restart would be a destructive
  // surprise to a process the user controls from their terminal.
  const borrowed = diag.data?.owns_process === false;

  return (
    <div className="space-y-6">
      <div
        role="status"
        aria-live="polite"
        data-testid="settings-engine-status"
        data-tone={tone}
        className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-4">
          <div
            className={[
              "flex h-10 w-10 items-center justify-center rounded-full",
              tone === "ok"
                ? "bg-emerald-50 dark:bg-emerald-950/30"
                : tone === "warn"
                  ? "bg-amber-50 dark:bg-amber-950/30"
                  : "bg-red-50 dark:bg-red-950/30",
            ].join(" ")}
          >
            <Activity
              className={[
                "h-5 w-5",
                tone === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : tone === "warn"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400",
              ].join(" ")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Engine is {label === "Running" ? "running" : label.toLowerCase()}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isLoading
                ? "Checking status…"
                : engine?.kind === "running"
                  ? `Version ${engine.version} · PID ${engine.pid}`
                  : subtitle ?? "Engine is not running"}
            </p>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              The engine starts automatically when the desktop launches and
              restarts itself if it exits unexpectedly. No manual controls are
              needed.
            </p>
          </div>
        </div>

        {restart.error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Engine restart failed</p>
              <p className="mt-1 break-words text-rose-700/90 dark:text-rose-300/90">
                {restart.error.message}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Log Level</h3>
        <div className="flex gap-2">
          {LOG_LEVELS.map((level) => {
            const isActive = level === currentLogLevel;
            return (
              <button
                key={level}
                onClick={() => handleLogLevelChange(level)}
                disabled={setSetting.isPending}
                aria-pressed={isActive}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-50",
                  isActive
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {level}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Engine diagnostics</h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Internal details for the bundled engine — PID, version parity, lockfile
          path, recent log lines, restart count. Useful when filing a bug or
          debugging a failure.
        </p>
        <DiagnosticsPanel
          diag={diag.data}
          onRestart={() => restart.mutate()}
          isRestarting={restart.isPending}
          borrowed={borrowed}
        />
      </div>
    </div>
  );
}

function CredentialsTab() {
  const { data: providers, isLoading: providersLoading } = useProviders();
  const providerItems = resolveProviderItems(providers, providersLoading);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected === null && providerItems.length > 0) {
      setSelected(providerItems[0].id);
    }
  }, [providerItems, selected]);
  const [apiKey, setApiKey] = useState("");
  const { data: credential } = useCredential(selected ?? "");
  const setCred = useSetCredential();
  const deleteCred = useDeleteCredential();
  const testCred = useTestCredential();

  useEffect(() => {
    // The Credential shape is `{ provider, hasKey, lastTested? }` —
    // we never see the raw key, only whether one is set. Clear the
    // input when the user switches providers.
    setApiKey("");
  }, [selected]);

  function handleSave() {
    if (!selected || !apiKey) return;
    setCred.mutate({ provider: selected, apiKey });
    setApiKey("");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Provider Credentials</h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Keys are stored in the OS keychain by the runtime
          (<code>peko credential set &lt;provider&gt; &lt;key&gt;</code>).
          The desktop never holds the secret beyond the save call.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {providerItems.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                selected === p.id
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              {p.displayName}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Status
            </span>
            {credential?.hasKey ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                Key set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                No key
              </span>
            )}
            {credential?.lastTested && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Last tested: {new Date(credential.lastTested).toLocaleString()}
              </span>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              API Key / Token
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={credential?.hasKey ? "•••••••• (leave blank to keep)" : "sk-..."}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!apiKey}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            {credential?.hasKey && selected && (
              <>
                <button
                  onClick={() => testCred.mutate(selected)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                >
                  <TestTube className="h-3.5 w-3.5" />
                  Test
                </button>
                <button
                  onClick={() => deleteCred.mutate(selected)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {testCred.data && (
        <div
          className={[
            "rounded-xl border p-4",
            testCred.data.success
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
          ].join(" ")}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {testCred.data.success ? (
              <>
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">Connection successful</span>
              </>
            ) : (
              <span className="text-red-700 dark:text-red-400">
                {testCred.data.message ?? "Connection failed"}
              </span>
            )}
          </div>
        </div>
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
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: FileJson },
  { id: "daemon", label: "Daemon", icon: FileJson },
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
      {active === "daemon" && <DaemonTab />}
      {active === "credentials" && <CredentialsTab />}
      {active === "runtimes" && <RuntimesTab />}
      {active === "about" && <AboutTab />}
    </div>
  );
}
