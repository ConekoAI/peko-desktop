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

  useEffect(() => {
    let cancelled = false;

    listen<StreamEvent>(channel, (event) => {
      if (cancelled) return;
      const payload = event.payload;
      setMessages((prev) => [...prev, payload]);

      if (payload.type === "chunk") {
        setIsStreaming(true);
      } else if (payload.type === "done" || payload.type === "error") {
        setIsStreaming(false);
      }

      if (payload.type === "error" && payload.content) {
        setError(payload.content);
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
      setMessages([]);
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
  }, []);

  return { messages, isStreaming, error, sendMessage, clearMessages };
}
