import { Hash } from "lucide-react";

/**
 * PR-1 placeholder for the channels landing page. The active
 * channel list lives in `ChannelSidebar` (mounted by `Layout`),
 * so this page just hosts an empty-state hint when no channel is
 * selected. PR-3 will replace this with a more useful "recent
 * activity" / "joined today" surface.
 */
export default function Channels() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Hash className="h-10 w-10 text-slate-300 dark:text-slate-700" />
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">
        Channels
      </h2>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Select a channel from the sidebar, or create one via the CLI
        (<code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
          peko channel create
        </code>
        ). PR-3 adds an in-app "New channel" button.
      </p>
    </div>
  );
}