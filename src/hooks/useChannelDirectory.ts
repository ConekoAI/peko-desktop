import { useMemo } from "react";

import { useChannelInfo } from "./useChannels";
import { usePekoDirectory, type ActorDisplay } from "./usePekoDirectory";
import { pekoIdentity } from "../lib/pekoIdentity";
import { findPerson, mentionablePekos, namedMentions } from "../lib/channelPeople";
import { shownAddress } from "../lib/format";
import { t } from "../i18n";

/**
 * Names for everyone in a channel: pekos on this computer (with their
 * faces) and "You" first, then the channel's own roster — pekos and
 * people on other computers by the names the runtime knows. `extra`
 * names people by address (a DM with another person).
 */
export function useChannelDirectory(
  channelId: string | undefined,
  extra?: Record<string, string>,
) {
  const local = usePekoDirectory();
  const { data: info } = useChannelInfo(channelId);
  const people = info?.people;
  return useMemo(() => {
    const resolve = (actor: string): ActorDisplay => {
      const named = extra?.[actor];
      if (named) return { label: named, peko: null, isYou: false };
      const mine = local.resolve(actor);
      if (mine.isYou || mine.peko) return mine;
      const who = findPerson(actor, people);
      if (!who) return mine;
      if (who.you) return { label: t("common.you"), peko: null, isYou: true };
      const label = who.name ?? shownAddress(who.address.replace(/^user:(hub:)?/, ""));
      return {
        label,
        peko: who.kind === "principal" && who.name ? pekoIdentity({ name: who.name }) : null,
        isYou: false,
      };
    };
    return {
      resolve,
      /** `@<address>` in a post, as `@name`. */
      named: (text: string) => namedMentions(text, people),
      /** The group's pekos, for the `@` picker. */
      pekoNames: mentionablePekos(people),
      /** When the channel began (its home's time), if the runtime says. */
      createdAt: info?.createdAt ?? null,
    };
  }, [local, people, extra, info?.createdAt]);
}
