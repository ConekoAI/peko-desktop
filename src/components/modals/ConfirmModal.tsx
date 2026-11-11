import { X, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  variant = "warning",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const confirmClass = variant === "danger" ? "btn-danger-solid" : "btn-primary";
  const iconTone =
    variant === "danger"
      ? "bg-danger-soft text-danger"
      : variant === "warning"
        ? "bg-warn-soft text-warn"
        : "bg-brand-soft text-brand-text";

  return (
    <div className="modal-backdrop">
      <div role="alertdialog" aria-labelledby="confirm-title" className="modal-panel max-w-md p-6">
        <div className="flex items-start gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="confirm-title" className="modal-title">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{message}</p>
          </div>
          <button onClick={onCancel} aria-label={t("common.close")} className="btn-icon -mr-2 -mt-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">
            {cancelText ?? t("common.cancel")}
          </button>
          <button onClick={onConfirm} className={confirmClass}>
            {confirmText ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
