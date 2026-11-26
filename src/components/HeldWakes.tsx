import { useTranslation } from "react-i18next";
import { useChangeChannelWakes, useChannelInfo, useChannelWakes } from "../hooks/useChannels";

/**
 * Says when other pekos have woken one of your pekos in this group as
 * often as its limit allows (runtime ADR-128): posts to it wait, and you
 * can let it continue. One line per peko of yours that is held; nothing
 * otherwise.
 */
export default function HeldWakes({ channelId }: { channelId: string }) {
  const { data: info } = useChannelInfo(channelId);
  if (info?.kind !== "group") return null;
  return (
    <>
      {info.pekos.map((peko) => (
        <HeldPeko key={peko.localId} channelId={channelId} pekoName={peko.name} />
      ))}
    </>
  );
}

function HeldPeko({ channelId, pekoName }: { channelId: string; pekoName: string }) {
  const { t } = useTranslation();
  const { data: wakes } = useChannelWakes(channelId, pekoName);
  const change = useChangeChannelWakes(channelId);
  if (!wakes || wakes.held === 0) return null;
  const until = wakes.freeAt
    ? new Date(wakes.freeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div
      className="flex items-center gap-3 border-t border-warn/25 bg-warn-soft px-4 py-2 text-xs text-fg"
      data-testid={`held-wakes-${pekoName}`}
    >
      <p className="min-w-0 flex-1">
        {until
          ? t("channel.heldWakes.until", { name: pekoName, held: wakes.held, time: until })
          : t("channel.heldWakes.waiting", { name: pekoName, held: wakes.held })}
        {change.error && (
          <span role="alert" className="ml-2 text-danger">
            {change.error.message}
          </span>
        )}
      </p>
      <button
        type="button"
        className="btn-secondary btn-sm shrink-0"
        disabled={change.isPending}
        onClick={() => change.mutate({ pekoName, reset: true })}
      >
        {t("channel.heldWakes.continue")}
      </button>
    </div>
  );
}
