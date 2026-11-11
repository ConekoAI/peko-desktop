// src/components/models/ModelGalleryCard.tsx
//
// Gallery card for the runtime model catalog (PR 4 /
// feature/model-first-config). Mirrors BundleCard's shape
// (border + name + meta + capability badges + actions) and
// replaces the flat-row `ModelCard` in Settings.tsx with a
// responsive grid rendering.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Edit3,
  Loader2,
  TestTube,
  Trash2,
} from "lucide-react";

import EditModelModal from "../modals/EditModelModal";
import {
  useRemoveModel,
  useTestModel,
  useUpdateModel,
} from "../../hooks/useModels";
import { specBadgeList } from "../../lib/model-spec";
import { resolveSpec, type ModelSummary } from "../../types";
import SpecBadge from "./SpecBadge";
import { apiFormatShort } from "../../lib/apiFormats";
import { currentLocale } from "../../i18n";

interface ModelGalleryCardProps {
  model: ModelSummary;
}

export default function ModelGalleryCard({ model }: ModelGalleryCardProps) {
  const { t } = useTranslation();
  const [showEdit, setShowEdit] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const updateModel = useUpdateModel();
  const removeModel = useRemoveModel();
  const testModel = useTestModel();

  const spec = resolveSpec(model);
  const badges = specBadgeList(spec);

  function handleToggleEnabled() {
    updateModel.mutate({ id: model.id, enabled: !model.enabled });
  }

  function handleTest() {
    testModel.mutate(model.id, {
      onSuccess: (result) => {
        setFeedback({
          ok: result.ok,
          text: result.ok
            ? result.modelUsed
              ? t("models.card.testPassedWith", { model: result.modelUsed })
              : t("models.card.testPassed")
            : result.message,
        });
      },
      onError: (err) => {
        setFeedback({
          ok: false,
          text: err instanceof Error ? err.message : t("models.card.testFailed"),
        });
      },
    });
  }

  function handleConfirmRemove() {
    removeModel.mutate(model.id, {
      onSuccess: () => setConfirmingRemove(false),
      onError: () => setConfirmingRemove(false),
    });
  }

  return (
    <div
      data-testid={`model-card-${model.id}`}
      className="card card-hover flex h-full flex-col p-4"
    >
      {/* Header: the name gets the full width; the format sits with
          the status pills below, so it never truncates the name. */}
      <div className="mb-2">
        <div className="min-w-0">
          <h3
            className={[
              "truncate text-base font-semibold",
              model.enabled
                ? "text-fg"
                : "text-fg-subtle",
            ].join(" ")}
            title={model.displayName}
          >
            {model.displayName}
          </h3>
        </div>
      </div>

      {/* Format + status pills */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span
            title={t("models.endpoint.apiFormat")}
            className="badge-neutral uppercase tracking-wide"
          >
            {apiFormatShort(model.apiFormat)}
          </span>
          {!model.enabled && (
            <span
              data-testid={`model-card-status-disabled-${model.id}`}
              className="badge-neutral"
            >
              {t("models.card.disabled")}
            </span>
          )}
          {model.requiresKey && !model.credentialId && (
            <span className="badge-warn">
              {t("models.card.noKey")}
            </span>
          )}
          {model.credentialId && (
            <span className="badge-ok">
              <Check className="h-2.5 w-2.5" />
              {t("models.card.keySet")}
            </span>
          )}
      </div>

      {/* Capability badges */}
      {badges.length > 0 && (
        <div
          className="mb-3 flex flex-wrap gap-1.5"
          data-testid={`model-card-specs-${model.id}`}
        >
          {badges.map((b) => (
            <SpecBadge
              key={b.kind}
              kind={b.kind}
              label={b.label}
              testId={`${b.testId}-${model.id}`}
            />
          ))}
        </div>
      )}

      {/* Metadata */}
      <div className="mb-4 flex-1 space-y-1 text-[11px] text-fg-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-mono" title={model.modelId}>
            {model.modelId}
          </span>
          {model.contextWindow !== undefined && (
            <span>{t("models.card.context", { n: model.contextWindow.toLocaleString(currentLocale()) })}</span>
          )}
          {model.maxOutputTokens !== undefined && (
            <span>{t("models.card.maxOutput", { n: model.maxOutputTokens.toLocaleString(currentLocale()) })}</span>
          )}
        </div>
        <div
          className="truncate font-mono text-[10px] text-fg-subtle"
          title={model.baseUrl}
        >
          {model.baseUrl}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={[
            "mb-2 text-[11px]",
            feedback.ok
              ? "text-brand-text"
              : "text-danger",
          ].join(" ")}
          data-testid={`model-card-feedback-${model.id}`}
        >
          {feedback.ok ? "✓ " : "✗ "}
          {feedback.text}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-fg-muted">
          <input
            type="checkbox"
            checked={model.enabled}
            onChange={handleToggleEnabled}
            data-testid={`model-card-enabled-${model.id}`}
            className="h-3.5 w-3.5"
          />
          {t("common.enabled")}
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTest}
            disabled={testModel.isPending}
            title={t("models.card.test")}
            data-testid={`model-card-test-${model.id}`}
            className="btn-icon"
          >
            {testModel.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setShowEdit(true)}
            title={t("common.edit")}
            data-testid={`model-card-edit-${model.id}`}
            className="btn-icon"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          {confirmingRemove ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-fg-muted">
                {t("models.card.removeConfirm")}
              </span>
              <button
                onClick={handleConfirmRemove}
                disabled={removeModel.isPending}
                data-testid={`model-card-confirm-remove-${model.id}`}
                className="btn-danger-solid btn-xs"
              >
                {removeModel.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {t("common.confirm")}
              </button>
              <button
                onClick={() => setConfirmingRemove(false)}
                disabled={removeModel.isPending}
                className="btn-secondary btn-xs"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              title={t("common.remove")}
              data-testid={`model-card-remove-${model.id}`}
              className="btn-icon hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {showEdit && (
        <EditModelModal open model={model} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}
