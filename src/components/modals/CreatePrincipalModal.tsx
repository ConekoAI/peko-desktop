import { X } from "lucide-react";

import { usePrincipals } from "../../hooks/usePrincipals";
import NewPekoForm from "../peko/NewPekoForm";

/**
 * "New peko" from the sidebar: the same name-and-avatar form as
 * onboarding's second step. Its chat opens as soon as the peko exists;
 * the sidebar shows it waking while its genesis turn runs.
 */
export default function CreatePrincipalModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** The new peko exists: open its chat. */
  onCreated?: (name: string) => void;
}) {
  const { data: principals } = usePrincipals();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-labelledby="new-peko-title"
        className="w-full max-w-md rounded-xl border border-line bg-surface-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="new-peko-title" className="text-base font-semibold text-fg">
            New peko
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <NewPekoForm
            takenNames={(principals ?? []).map((p) => p.name)}
            onCreated={(name) => {
              onCreated?.(name);
              onClose();
            }}
            secondary={
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-line bg-surface-card px-4 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
              >
                Cancel
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
