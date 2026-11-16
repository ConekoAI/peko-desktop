import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { updateCheck, updateInstall } from "../lib/api";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a newer Peko Desktop exists: asked when the app starts and
 * once a day after. A check that fails is an error on the query; the
 * banner shows nothing for it, and Settings says so when asked.
 */
export function useAppUpdate() {
  return useQuery({
    queryKey: ["app-update"],
    queryFn: updateCheck,
    staleTime: 60 * 60 * 1000,
    refetchInterval: DAY_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export type InstallState =
  | { phase: "idle" }
  /** `fraction` is 0–1, or null while the size isn't known. */
  | { phase: "downloading"; fraction: number | null }
  | { phase: "installing" }
  | { phase: "failed" };

/**
 * Installing the update: download with progress, then the app replaces
 * itself and restarts, so a successful install never reports back.
 */
export function useUpdateInstall() {
  const [state, setState] = useState<InstallState>({ phase: "idle" });
  const busy = state.phase === "downloading" || state.phase === "installing";

  useEffect(() => {
    if (!busy) return;
    let gone = false;
    let unlisten: (() => void) | undefined;
    void listen<{ downloaded: number; total: number | null }>("update-progress", (event) => {
      if (gone) return;
      const { downloaded, total } = event.payload;
      setState(
        total && downloaded >= total
          ? { phase: "installing" }
          : { phase: "downloading", fraction: total ? downloaded / total : null },
      );
    }).then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [busy]);

  async function install() {
    setState({ phase: "downloading", fraction: null });
    try {
      await updateInstall();
      // Nothing newer after all: back to rest.
      setState({ phase: "idle" });
    } catch {
      setState({ phase: "failed" });
    }
  }

  return { state, busy, install };
}
