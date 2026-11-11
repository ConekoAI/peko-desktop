import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { data: principals } = usePrincipals();
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div
        role="dialog"
        aria-labelledby="new-peko-title"
        className="modal-panel w-full max-w-md"
      >
        <div className="modal-header justify-between">
          <h2 id="new-peko-title" className="modal-title">
            {t("peko.new.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="btn-icon -mr-1.5"
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
                className="btn-secondary"
              >
                {t("common.cancel")}
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
