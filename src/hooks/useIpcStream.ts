import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { StreamEvent } from "../types";

interface UseIpcStreamOptions {
  channel?: string;
}

export function useIpcStream(options: UseIpcStreamOptions = {}) {
  const { channel = "peko-stream" } = options;
  const [messages, setMessages] = useState<StreamEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  // Track whether we're currently accumulating an assistant message
  const accumulatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    listen<StreamEvent>(channel, (event) => {
      if (cancelled) return;
      const payload = event.payload;

      if (payload.type === "chunk") {
        setIsStreaming(true);
        accumulatingRef.current = true;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // If the last message is also a chunk (and not a user message),
          // append content to it instead of creating a new message.
          // We distinguish user messages by checking if they were added
          // outside this hook (they have a synthetic timestamp from Date.now()).
          // A simpler approach: if last is a chunk with no id, it's from streaming.
          if (last && last.type === "chunk" && !last.id) {
            const updated: StreamEvent = {
              ...last,
              content: (last.content ?? "") + (payload.content ?? ""),
            };
            return [...prev.slice(0, -1), updated];
          }
          return [...prev, payload];
        });
      } else if (payload.type === "done") {
        setIsStreaming(false);
        accumulatingRef.current = false;
        // Don't add Done events to the message list — they're control signals
      } else if (payload.type === "error") {
        setIsStreaming(false);
        accumulatingRef.current = false;
        if (payload.content) {
          setError(payload.content);
        }
        setMessages((prev) => [...prev, payload]);
      } else {
        // tool_call, tool_result, etc.
        setMessages((prev) => [...prev, payload]);
      }
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
  }, [channel]);

  const sendMessage = useCallback(
    async (invokeFn: () => Promise<void>) => {
      setError(null);
      setIsStreaming(true);
      try {
        await invokeFn();
      } catch (err) {
        setIsStreaming(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    accumulatingRef.current = false;
  }, []);

  return { messages, isStreaming, error, sendMessage, clearMessages };
}
