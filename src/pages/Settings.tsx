import { useState, useEffect } from "react";
import {
  useSettings,
  useSetSetting,
  useCredential,
  useSetCredential,
  useDeleteCredential,
  useTestCredential,
} from "../hooks/useSettings";
import { useDaemonStatus, useDaemonStart, useDaemonStop, useDaemonRestart } from "../hooks/useDaemon";
import { getTheme, setTheme } from "../lib/theme";
import {
  Save,
  Key,
  FileJson,
  Info,
  Check,
  Trash2,
  TestTube,
  Play,
  Square,
  RotateCcw,
  Loader2,
  Sun,
  Moon,
  Monitor,
  FolderOpen,
} from "lucide-react";
import type { Credential } from "../types";

type Tab = "general" | "daemon" | "credentials" | "about";

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

function DaemonTab() {
  const { data: daemon, isLoading } = useDaemonStatus();
  const start = useDaemonStart();
  const stop = useDaemonStop();
  const restart = useDaemonRestart();
  const isMutating = start.isPending || stop.isPending || restart.isPending;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Daemon Status</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isLoading
                ? "Checking status..."
                : daemon?.running
                  ? `Running · Version ${daemon.version}${daemon.pid ? ` · PID ${daemon.pid}` : ""}`
                  : "Daemon is not running"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!daemon?.running && (
              <button
                onClick={() => start.mutate()}
                disabled={isMutating}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start
              </button>
            )}
            {daemon?.running && (
              <>
                <button
                  onClick={() => stop.mutate()}
                  disabled={isMutating}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {stop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  Stop
                </button>
                <button
                  onClick={() => restart.mutate()}
                  disabled={isMutating}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {restart.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Restart
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Log Level</h3>
        <div className="flex gap-2">
          {(["trace", "debug", "info", "warn", "error"] as const).map((level) => (
            <button
              key={level}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CredentialsTab() {
  const providers = ["openai", "anthropic", "kimi", "ollama", "azure", "google"];
  const [selected, setSelected] = useState(providers[0]);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const { data: credential } = useCredential(selected);
  const setCred = useSetCredential();
  const deleteCred = useDeleteCredential();
  const testCred = useTestCredential();

  useEffect(() => {
    setUsername(credential?.username ?? "");
    setToken(credential?.token ?? "");
  }, [credential]);

  function handleSave() {
    if (!selected) return;
    const payload: Credential = { provider: selected };
    if (username) payload.username = username;
    if (token) payload.token = token;
    setCred.mutate(payload);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Provider Credentials</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => setSelected(p)}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                selected === p
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              API Key / Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Username / Key ID (optional)
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            {credential && (
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
      {active === "about" && <AboutTab />}
    </div>
  );
}
