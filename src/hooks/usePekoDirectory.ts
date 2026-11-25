import { useMemo } from "react";

import {
  useLocalUserAccount,
  useYou,
  usePrincipals,
  type PrincipalSummary,
} from "./usePrincipals";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";
import { shownAddress } from "../lib/format";
import { t } from "../i18n";

/** How an actor (a channel member or author) is shown. */
export interface ActorDisplay {
  /**
   * Your name ("You" from a runtime too old to say), a peko's name,
   * or the actor's own id when unknown.
   */
  label: string;
  /** Set for pekos on this runtime. */
  peko: PekoIdentity | null;
  /** A person's PekoHub handle (runtime ADR-124), when known. */
  handle?: string | null;
  /** The local user (this computer's person). */
  isYou: boolean;
}

/**
 * Whether `actor` is this computer's person: the runtime's local user,
 * or the PekoHub account it is linked to (`linkedAccount`, runtime
 * ADR-081 D3) — one person under two addresses.
 */
export function isLocalUser(actor: string, linkedAccount?: string | null): boolean {
  if (actor === "user:local" || actor === "user:local:local") return true;
  return !!linkedAccount && actor === `user:hub:${linkedAccount}`;
}

/**
 * Resolve actors to names and faces from the pekos on this runtime.
 * Accepts the forms the runtime uses: `principal:<local id>`,
 * `principal:local:<local id>`, `user:local`, `user:hub:<id>`, a bare
 * local id, or a peko name. `linkedAccount` is the PekoHub account the
 * local user is linked to, so its address reads as you too. `yourName`
 * is what the runtime calls you (PekoHub name, else login name); without
 * it you read as "You".
 */
export function resolveActor(
  actor: string,
  pekos: PrincipalSummary[],
  linkedAccount?: string | null,
  yourName?: string | null,
  yourHandle?: string | null,
): ActorDisplay {
  if (isLocalUser(actor, linkedAccount)) {
    return { label: yourName || t("common.you"), peko: null, isYou: true, handle: yourHandle ?? null };
  }
  const id = actor.replace(/^principal:(local:)?/, "");
  const peko =
    pekos.find((p) => p.localId && p.localId === id) ?? pekos.find((p) => p.name === id);
  if (peko) {
    return { label: peko.name, peko: pekoIdentity(peko), isYou: false };
  }
  return { label: shownAddress(actor.replace(/^user:(hub:)?/, "")), peko: null, isYou: false };
}

/** `resolveActor` bound to the current peko list, and identities by name. */
export function usePekoDirectory() {
  const { data } = usePrincipals();
  const { data: account } = useLocalUserAccount();
  const you = useYou();
  const linked = account?.id ?? null;
  return useMemo(() => {
    const pekos = data ?? [];
    return {
      resolve: (actor: string) => resolveActor(actor, pekos, linked, you.name, you.handle),
      /** What you are called here (`"You"` when the runtime can't say). */
      yourName: you.name,
      /** Your PekoHub handle, while signed in. */
      yourHandle: you.handle,
      identityOf: (name: string): PekoIdentity => {
        const peko = pekos.find((p) => p.name === name);
        return pekoIdentity(peko ?? { name });
      },
    };
  }, [data, linked, you.name, you.handle]);
}
