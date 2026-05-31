import { useRef, useEffect } from "react";
import type { StreamEvent } from "../types";

interface ChatStreamProps {
  messages: StreamEvent[];
  className?: string;
}

export default function ChatStream({ messages, className = "" }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className={[
        "flex flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950",
        className,
      ].join(" ")}
    >
      {messages.length === 0 && (
        <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
          No messages yet
        </div>
      )}

      {messages.map((msg) => {
        if (msg.type === "chunk" || msg.type === "tool_call" || msg.type === "tool_result") {
          return (
            <div
              key={msg.id}
              className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              {msg.content}
            </div>
          );
        }

        if (msg.type === "error") {
          return (
            <div
              key={msg.id}
              className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400"
            >
              {msg.content}
            </div>
          );
        }

        return null;
      })}

      <div ref={bottomRef} />
    </div>
  );
}
