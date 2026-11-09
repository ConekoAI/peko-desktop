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
        "flex flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface-card p-4",
        className,
      ].join(" ")}
    >
      {messages.length === 0 && (
        <div className="py-8 text-center text-sm text-fg-subtle">
          No messages yet
        </div>
      )}

      {messages.map((msg) => {
        if (msg.type === "chunk" || msg.type === "tool_call" || msg.type === "tool_result") {
          return (
            <div
              key={msg.id}
              className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-surface-sunken px-4 py-2.5 text-sm text-fg"
            >
              {msg.content}
            </div>
          );
        }

        if (msg.type === "error") {
          return (
            <div
              key={msg.id}
              className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-danger-soft px-4 py-2.5 text-sm text-danger"
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
