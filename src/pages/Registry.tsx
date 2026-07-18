import { useState } from "react";
import {
  useRegistrySearch,
  useRegistryPull,
  useAuthStatus,
} from "../hooks/useRegistry";
import BundleCard from "../components/BundleCard";
import {
  Search,
  Loader2,
  User,
  LogIn,
  LogOut,
  X,
} from "lucide-react";

function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login } = useAuthStatus();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !token.trim()) return;
    login.mutate(
      { username: username.trim(), token: token.trim() },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Registry Login
          </h2>
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
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="personal access token"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
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
              disabled={login.isPending || !username.trim() || !token.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {login.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Log In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Registry() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loginOpen, setLoginOpen] = useState(false);
  const perPage = 12;

  const { data, isLoading } = useRegistrySearch(query, page, perPage);
  const pull = useRegistryPull();
  const { data: auth, isLoading: authLoading, logout } = useAuthStatus();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Registry</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search and install bundles from PekoHub
          </p>
        </div>

        <div className="flex items-center gap-3">
          {authLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : auth?.authenticated ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <User className="h-3 w-3" />
                {auth.username ?? "Authenticated"}
              </span>
              <button
                onClick={() => logout.mutate()}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <LogIn className="h-4 w-4" />
              Log In
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bundles..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-600"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {data && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <BundleCard
                key={item.ref}
                bundle={item}
                onInstall={(ref) => pull.mutate(ref)}
                isInstalling={pull.isPending && pull.variables === item.ref}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                Previous
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : query.length > 0 && !isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">
          No results found for "{query}"
        </div>
      ) : null}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
