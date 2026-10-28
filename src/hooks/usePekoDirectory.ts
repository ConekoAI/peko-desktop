import { useMemo } from "react";

import { usePrincipals, type PrincipalSummary } from "./usePrincipals";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";

/** How an actor (a channel member or author) is shown. */
export interface ActorDisplay {
  /** "You", a peko's name, or the actor's own id when unknown. */
  label: string;
  /** Set for pekos on this runtime. */
  peko: PekoIdentity | null;
  /** The local user (this computer's person). */
  isYou: boolean;
}

/**
 * Resolve actors to names and faces from the pekos on this runtime.
 * Accepts the forms the runtime uses: `principal:<local id>`,
 * `principal:local:<local id>`, `user:local`, `user:hub:<id>`, a bare
 * local id, or a peko name.
 */
export function resolveActor(actor: string, pekos: PrincipalSummary[]): ActorDisplay {
  if (actor === "user:local" || actor === "user:local:local") {
    return { label: "You", peko: null, isYou: true };
  }
  const id = actor.replace(/^principal:(local:)?/, "");
  const peko =
    pekos.find((p) => p.localId && p.localId === id) ?? pekos.find((p) => p.name === id);
  if (peko) {
    return { label: peko.name, peko: pekoIdentity(peko), isYou: false };
  }
  return { label: actor.replace(/^user:(hub:)?/, ""), peko: null, isYou: false };
}

/** `resolveActor` bound to the current peko list, and identities by name. */
export function usePekoDirectory() {
  const { data } = usePrincipals();
  return useMemo(() => {
    const pekos = data ?? [];
    return {
      resolve: (actor: string) => resolveActor(actor, pekos),
      identityOf: (name: string): PekoIdentity => {
        const peko = pekos.find((p) => p.name === name);
        return pekoIdentity(peko ?? { name });
      },
    };
  }, [data]);
}
