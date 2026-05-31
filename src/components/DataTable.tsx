import { useState, useMemo, type ReactNode } from "react";
import { ChevronUp, ChevronDown, Search } from "lucide-react";

type SortDir = "asc" | "desc" | null;

export interface Column<T> {
  key: string;
  header: ReactNode;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  emptyText?: string;
  searchable?: boolean;
  searchKeys?: string[];
  pageSize?: number;
}

export default function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  emptyText = "No data",
  searchable = true,
  searchKeys,
  pageSize,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  }

  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter((row) => {
      const keys = searchKeys ?? columns.map((c) => c.key);
      return keys.some((key) => {
        const val = (row as Record<string, unknown>)[key];
        if (val == null) return false;
        return String(val).toLowerCase().includes(term);
      });
    });
  }, [rows, search, searchable, searchKeys, columns]);

  const sorted = useMemo(() => {
    const data = [...filtered];
    if (sortKey && sortDir) {
      data.sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string" && typeof bv === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (typeof av === "number" && typeof bv === "number") {
          return sortDir === "asc" ? av - bv : bv - av;
        }
        return 0;
      });
    }
    return data;
  }, [filtered, sortKey, sortDir]);

  const paged = useMemo(() => {
    if (!pageSize) return sorted;
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const totalPages = pageSize ? Math.ceil(sorted.length / pageSize) : 1;

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-600"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={[
                    "px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300",
                    col.sortable ? "cursor-pointer select-none" : "",
                  ].join(" ")}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900/50"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
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
        </div>
      )}
    </div>
  );
}
