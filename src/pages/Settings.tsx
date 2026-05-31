import { useState } from "react";
import { useSettings, useSetSetting } from "../hooks/useSettings";
import { useCredential, useSetCredential, useDeleteCredential, useTestCredential } from "../hooks/useSettings";
import { Save, Key, FileJson, Info, Check, Trash2, TestTube } from "lucide-react";
import type { Credential } from "../types";

type Tab = "general" | "credentials" | "config" | "about";

function GeneralTab() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  function handleChange(key: string, value: string) {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(key: string) {
    const value = localValues[key];
    if (value !== undefined) {
      setSetting.mutate({ key, value });
    }
  }

  return (
    <div className="space-y-4">
      {settings?.map((s) => (
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
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
            <button
              onClick={() => handleSave(s.key)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CredentialsTab() {
  const [provider, setProvider] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const { data: credential } = useCredential(provider);
  const setCred = useSetCredential();
  const deleteCred = useDeleteCredential();
  const testCred = useTestCredential();

  function handleSave() {
    if (!provider) return;
    const payload: Credential = { provider };
    if (username) payload.username = username;
    if (token) payload.token = token;
    setCred.mutate(payload);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          Add / Update Credential
        </h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Provider
            </label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. openai, anthropic"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Username / Key ID
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Token / Secret
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            {credential && (
              <>
                <button
                  onClick={() => testCred.mutate(provider)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                >
                  <TestTube className="h-3.5 w-3.5" />
                  Test
                </button>
                <button
                  onClick={() => deleteCred.mutate(provider)}
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

function ConfigTab() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Config editor coming soon. Edit <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">config.toml</code> directly for now.
      </p>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-600" />
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
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: FileJson },
  { id: "credentials", label: "Credentials", icon: Key },
  { id: "config", label: "Config Editor", icon: FileJson },
  { id: "about", label: "About", icon: Info },
];

export default function Settings() {
  const [active, setActive] = useState<Tab>("general");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure your Peko environment
        </p>
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
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
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
      {active === "config" && <ConfigTab />}
      {active === "about" && <AboutTab />}
    </div>
  );
}
