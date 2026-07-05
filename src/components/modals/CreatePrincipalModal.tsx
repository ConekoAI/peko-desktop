import { X, Terminal } from "lucide-react";

/**
 * Principal creation guidance. The desktop does not currently expose a
 * `peko principal new` IPC variant (creation is a CLI/file operation:
 * the runtime materializes a `<workspace>/agents/<name>.md` prompt
 * file). This modal is the in-app pointer for that flow. When
 * `principal_create` is added to the IPC bridge (post-launch), this
 * stub becomes the wiring point.
 */
export default function CreatePrincipalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Create a Principal
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5 text-sm text-slate-700 dark:text-slate-300">
          <p>
            Principals are the only top-level runtime actor (ADR-041). They
            are created by writing the principal's prompt file into the
            active workspace&apos;s <code>agents/</code> directory.
          </p>

          <p>From your terminal:</p>
          <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
{`peko principal new <name> \\
  --provider openai \\
  --model gpt-4o \\
  --description "What this principal does"`}
          </pre>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            The CLI writes <code>&lt;workspace&gt;/agents/&lt;name&gt;.md</code> with
            frontmatter and refreshes the principal index. Refresh the
            sidebar to see the new principal.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
