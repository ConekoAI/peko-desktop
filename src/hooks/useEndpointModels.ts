import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { modelDiscover } from "../lib/api";

/** How long typing must pause before the endpoint is asked. */
export const DISCOVER_DEBOUNCE_MS = 600;

/**
 * The chat models an endpoint offers, asked of the endpoint itself once
 * its base URL and key are filled in, so a model is picked from a list
 * rather than typed. `enabled: false` (an incomplete form, or a stored
 * credential whose key the form never sees) asks nothing.
 */
export function useEndpointModels(
  baseUrl: string,
  apiFormat: string,
  key: string | undefined,
  enabled: boolean,
) {
  const target = enabled ? JSON.stringify([baseUrl.trim(), apiFormat, key?.trim() ?? ""]) : "";
  const [settled, setSettled] = useState(target);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(target), DISCOVER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [target]);

  return useQuery({
    queryKey: ["endpoint-models", settled],
    queryFn: () => {
      const [url, format, k] = JSON.parse(settled) as [string, string, string];
      return modelDiscover(url, format, k || undefined);
    },
    enabled: !!settled && settled === target,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
  });
}
