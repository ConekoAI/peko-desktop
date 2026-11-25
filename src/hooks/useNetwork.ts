import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { networkSettingsSet, networkStatus, type NetworkChange } from "../lib/api";
import { ACCOUNT_DEVICES_KEY } from "./useAccountDevices";

/** The query key every view of how this computer connects shares. */
export const NETWORK_KEY = ["network-status"];

/**
 * How this computer connects to your other computers and how each is
 * reached now (runtime ADR-125). One query for Settings → Network, the
 * Devices list and the chat's "waits until you are on the same network".
 */
export function useNetworkStatus(enabled = true) {
  return useQuery({
    queryKey: NETWORK_KEY,
    queryFn: networkStatus,
    enabled,
    refetchInterval: 10_000,
    retry: false,
  });
}

/** Change how this computer connects; the engine applies it at once. */
export function useSetNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: NetworkChange) => networkSettingsSet(change),
    onSuccess: (status) => {
      qc.setQueryData(NETWORK_KEY, status);
      void qc.invalidateQueries({ queryKey: ACCOUNT_DEVICES_KEY });
    },
  });
}
