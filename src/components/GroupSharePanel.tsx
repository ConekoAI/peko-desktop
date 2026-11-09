import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2 } from "lucide-react";
import { groupLink, groupRegister } from "../lib/api";
import type { ChannelInfo } from "../lib/api";

type Visibility = "invite_only" | "public";

/**
 * Share a group with people on other computers (runtime ADR-092 D5).
 * Shown at the group's home only, where it is registered and its invite
 * links are made. Registering gives it an ID on PekoHub; an invite-only
 * group is joined with a link, a public one with its ID too.
 */
export default function GroupSharePanel({
  channelId,
  group,
}: {
  channelId: string;
  group: NonNullable<ChannelInfo["group"]>;
}) {
  const qc = useQueryClient();
  const [visibility, setVisibility] = useState<Visibility>(group.visibility ?? "invite_only");
  const register = useMutation({
    mutationFn: (v: Visibility) => groupRegister(channelId, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channel-info", channelId] }),
  });
  const link = useMutation({
    mutationFn: (revoke: boolean) => groupLink(channelId, { revoke }),
  });
  const error = register.error ?? link.error;
  const registered = !!group.hubId;

  return (
    <div className="space-y-3 border-t border-line bg-surface-raised/60 px-4 py-3 text-sm" data-testid="group-share">
      {registered ? (
        <div className="flex flex-wrap items-center gap-2 text-fg-soft">
          <span>
            Group ID <span className="font-mono text-fg" data-testid="group-share-id">{group.hubId}</span>
          </span>
          <CopyButton value={group.hubId!} label="Copy ID" />
          <span className="text-fg-subtle">·</span>
          <span>{group.visibility === "public" ? "Anyone with the ID can join" : "Only people with an invite link can join"}</span>
        </div>
      ) : (
        <p className="text-fg-soft">
          Give this group an ID on PekoHub, so people on other computers can join it. Its messages stay on this
          computer.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          className="select input-sm w-auto pr-7"
          data-testid="group-share-visibility"
        >
          <option value="invite_only">Invite only</option>
          <option value="public">Public</option>
        </select>
        <button
          type="button"
          disabled={register.isPending || (registered && visibility === group.visibility)}
          onClick={() => register.mutate(visibility)}
          className="btn-primary btn-sm"
          data-testid="group-share-register"
        >
          {registered ? "Save" : register.isPending ? "Registering…" : "Register on PekoHub"}
        </button>
        {registered && (
          <>
            <button
              type="button"
              disabled={link.isPending}
              onClick={() => link.mutate(false)}
              className="btn-ghost btn-xs"
              data-testid="group-share-link"
            >
              <Link2 className="h-3.5 w-3.5" />
              Make an invite link
            </button>
            <button
              type="button"
              disabled={link.isPending}
              onClick={() => link.mutate(true)}
              className="btn-ghost btn-xs"
              data-testid="group-share-revoke"
            >
              Stop all links
            </button>
          </>
        )}
      </div>
      {link.data?.link && (
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface py-1 pl-3 pr-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" data-testid="group-share-link-value">
            {link.data.link}
          </code>
          <CopyButton value={link.data.link} label="Copy link" />
        </div>
      )}
      {link.data?.link && link.data.expires && (
        <div className="text-xs text-fg-subtle">Works until {new Date(link.data.expires).toLocaleString()}.</div>
      )}
      {link.data?.revoked != null && (
        <div className="text-xs text-fg-subtle" data-testid="group-share-revoked">
          {link.data.revoked === 0 ? "No links were working." : `Stopped ${link.data.revoked} link(s).`}
        </div>
      )}
      {error && (
        <div className="text-xs text-danger">
          {String(error instanceof Error ? error.message : error)}
        </div>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="btn-icon"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
