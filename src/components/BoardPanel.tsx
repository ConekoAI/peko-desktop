import { useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, Loader2, Plus } from "lucide-react";
import { useChangeBoard, useChannelBoard, useChannelInfo } from "../hooks/useChannels";
import { useChannelDirectory } from "../hooks/useChannelDirectory";
import type { BoardItem, BoardOp } from "../types";

/**
 * A group's board (runtime ADR-101): who is doing what. Members and
 * their pekos add items, claim them, mark them blocked or done. The
 * runtime decides who may change what and says why when it refuses.
 *
 * Collapsed to a one-line summary by default so the conversation stays
 * in front; a check-in that came due shows in the summary.
 */
export default function BoardPanel({ channelId }: { channelId: string }) {
  const { data: info } = useChannelInfo(channelId);
  const isGroup = info?.kind === "group";
  const { data: items } = useChannelBoard(channelId, isGroup);
  const change = useChangeBoard(channelId);
  const directory = useChannelDirectory(channelId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [blocking, setBlocking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const now = Date.now();

  const all = items ?? [];
  const active = all.filter((i) => i.state !== "done");
  const due = active.filter(
    (i) => i.claimant && i.check_at && Date.parse(i.check_at) <= now,
  );
  const blocked = active.filter((i) => i.state === "blocked");

  function run(op: BoardOp, after?: () => void) {
    change.mutate(op, { onSuccess: () => after?.() });
  }

  const summary = all.length === 0
    ? "No work on the board yet"
    : [
        `${active.length} open`,
        blocked.length > 0 ? `${blocked.length} blocked` : null,
        due.length > 0 ? `${due.length} past check-in` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  if (!isGroup) return null;
  return (
    <section className="border-b border-line bg-surface-raised/60 text-xs" data-testid="board-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-fg-muted transition-colors hover:bg-surface-sunken/60"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <ClipboardList className="h-3.5 w-3.5 text-brand-text" />
        <span className="font-semibold text-fg">Board</span>
        <span data-testid="board-summary">{summary}</span>
      </button>
      {open && (
        <div className="grid gap-2 px-4 pb-3 pt-1">
          {all.map((item) => {
            const holder = item.claimant ? directory.resolve(item.claimant) : null;
            const mine = !!holder?.isYou;
            const addedByMe = directory.resolve(item.added_by).isYou;
            const pastCheckIn = !!item.check_at && item.state !== "done" && Date.parse(item.check_at) <= now;
            return (
              <div key={item.id} className="card px-3 py-2.5" data-testid="board-item">
                <div className="flex items-center gap-2">
                  <StateChip state={item.state} />
                  <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-fg">{item.title}</span>
                  <span className="shrink-0 text-fg-subtle">
                    {holder
                      ? holder.label
                      : item.for
                        ? `for ${directory.resolve(item.for).label}`
                        : "unclaimed"}
                  </span>
                </div>
                {(item.note || item.check_at) && (
                  <div className="mt-1 text-fg-subtle">
                    {item.note}
                    {item.check_at && item.state !== "done" && (
                      <span className={pastCheckIn ? "ml-1 text-warn" : "ml-1"}>
                        {pastCheckIn ? "past its check-in" : "check-in"}{" "}
                        {new Date(item.check_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
                {blocking === item.id ? (
                  <form
                    className="mt-2 flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        { op: "update", item: item.id, state: "blocked", note: note.trim() || undefined },
                        () => {
                          setBlocking(null);
                          setNote("");
                        },
                      );
                    }}
                  >
                    <input
                      autoFocus
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What does it wait on?"
                      maxLength={500}
                      className="input input-sm min-w-0 flex-1"
                    />
                    <button type="submit" className="btn-secondary btn-xs">
                      Block
                    </button>
                    <button type="button" onClick={() => setBlocking(null)} className="btn-ghost btn-xs">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!item.claimant && item.state !== "done" && (
                      <Action label="Take it" onClick={() => run({ op: "claim", item: item.id })} />
                    )}
                    {mine && item.state !== "done" && (
                      <>
                        {item.state === "blocked" && (
                          <Action label="Unblock" onClick={() => run({ op: "update", item: item.id, state: "doing" })} />
                        )}
                        {item.state !== "blocked" && (
                          <Action label="Blocked…" onClick={() => setBlocking(item.id)} />
                        )}
                        <Action label="Done" onClick={() => run({ op: "update", item: item.id, state: "done" })} />
                        <Action label="Let go" onClick={() => run({ op: "release", item: item.id })} />
                      </>
                    )}
                    {!mine && addedByMe && item.state !== "done" && (
                      <Action label="Mark done" onClick={() => run({ op: "update", item: item.id, state: "done" })} />
                    )}
                    {addedByMe && (
                      <Action label="Remove" onClick={() => run({ op: "drop", item: item.id })} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <form
            className="flex gap-1.5 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.trim();
              if (!t) return;
              run({ op: "add", title: t }, () => setTitle(""));
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add work to the board"
              maxLength={120}
              className="input input-sm min-w-0 flex-1"
              aria-label="New board item"
            />
            <button
              type="submit"
              disabled={!title.trim() || change.isPending}
              className="btn-primary btn-sm"
            >
              {change.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </button>
          </form>
          {change.error && (
            <p className="text-danger" role="alert">
              {change.error instanceof Error ? change.error.message : String(change.error)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-secondary btn-xs"
    >
      {label}
    </button>
  );
}

const STATE_STYLE: Record<BoardItem["state"], string> = {
  open: "bg-surface-sunken text-fg-muted",
  doing: "bg-brand-soft text-brand-text",
  blocked: "bg-warn-soft text-warn",
  done: "bg-surface-sunken text-fg-subtle line-through",
};

function StateChip({ state }: { state: BoardItem["state"] }) {
  return (
    <span className={`badge shrink-0 uppercase tracking-wide ${STATE_STYLE[state]}`}>
      {state}
    </span>
  );
}
