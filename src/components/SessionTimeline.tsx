import type { SessionMessage } from "../types";
import { formatDate } from "../lib/format";
import { User, Bot, Wrench, AlertCircle } from "lucide-react";

interface SessionTimelineProps {
  messages: SessionMessage[];
  className?: string;
}

const ROLE_ICON: Record<string, React.ReactNode> = {
  user: <User className="h-3.5 w-3.5" />,
  assistant: <Bot className="h-3.5 w-3.5" />,
  system: <AlertCircle className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
};

const ROLE_STYLE: Record<string, string> = {
  user: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  assistant: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  system: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  tool: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function SessionTimeline({ messages, className = "" }: SessionTimelineProps) {
  return (
    <div className={["space-y-4", className].join(" ")}>
      {messages.map((msg) => (
        <div key={msg.id} className="flex gap-3">
          <div
            className={[
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
              ROLE_STYLE[msg.role] ?? ROLE_STYLE.system,
            ].join(" ")}
          >
            {ROLE_ICON[msg.role] ?? ROLE_ICON.system}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold capitalize text-slate-700 dark:text-slate-300">
                {msg.role}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600">
                {formatDate(msg.timestamp)}
              </span>
            </div>
            <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              {msg.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
