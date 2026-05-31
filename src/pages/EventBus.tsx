import { useState, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { formatDate } from "../lib/format";
import { Radio, Trash2 } from "lucide-react";

interface BusEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export default function EventBus() {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [filter, setFilter] = useState("");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<BusEvent>("peko-event", (event) => {
      if (cancelled) return;
      setEvents((prev) => [event.payload, ...prev].slice(0, 500));
    }).then((unlisten) => {
      if (!cancelled) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    });
    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const filtered = filter
    ? events.filter((e) => e.topic.toLowerCase().includes(filter.toLowerCase()))
    : events;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Event Bus</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live event stream
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            <Radio className="h-3 w-3" />
            Live
          </span>
          <button
            onClick={() => setEvents([])}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by topic..."
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-600"
      />

      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Time</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Topic</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Payload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-600">
                  No events
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500 dark:text-slate-500">
                    {formatDate(e.timestamp)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                      {e.topic}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <code className="text-xs text-slate-600 dark:text-slate-400">
                      {JSON.stringify(e.payload).slice(0, 120)}
                      {JSON.stringify(e.payload).length > 120 ? "…" : ""}
                    </code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
