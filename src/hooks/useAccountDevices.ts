import { useQuery } from "@tanstack/react-query";
import { accountDevices } from "../lib/api";

/** The query key every view of your account's devices shares. */
export const ACCOUNT_DEVICES_KEY = ["account-devices"];

/**
 * Your account's devices and what waits about it (runtime ADR-111). One
 * query for the Devices panel, the banner and the Settings badge; `watch`
 * reads it more often (while a code is on screen).
 */
export function useAccountDevices(watch = false) {
  return useQuery({
    queryKey: ACCOUNT_DEVICES_KEY,
    queryFn: accountDevices,
    refetchInterval: watch ? 2000 : 30_000,
    retry: false,
  });
}
