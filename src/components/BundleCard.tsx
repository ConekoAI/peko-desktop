import { Download, Tag, User, Loader2 } from "lucide-react";
import type { BundleItem, SearchResult } from "../types";

type Bundle = BundleItem | SearchResult;

interface BundleCardProps {
  bundle: Bundle;
  onInstall?: (ref: string) => void;
  isInstalling?: boolean;
}

function isSearchResult(b: Bundle): b is SearchResult {
  return "downloads" in b;
}

export default function BundleCard({ bundle, onInstall, isInstalling }: BundleCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-start justify-between">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          {bundle.name}
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          v{bundle.version}
        </span>
      </div>

      {bundle.description && (
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          {bundle.description}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-500">
        {bundle.author && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {bundle.author}
          </span>
        )}
        {isSearchResult(bundle) && (
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {bundle.downloads.toLocaleString()}
          </span>
        )}
      </div>

      {bundle.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {bundle.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {onInstall && (
        <button
          onClick={() => onInstall(bundle.ref)}
          disabled={isInstalling}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {isInstalling ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing...
            </>
          ) : (
            "Install"
          )}
        </button>
      )}
    </div>
  );
}
