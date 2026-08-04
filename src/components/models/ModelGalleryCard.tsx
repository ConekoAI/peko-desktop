// src/components/models/ModelGalleryCard.tsx
//
// Gallery card for the runtime model catalog (PR 4 /
// feature/model-first-config). Mirrors BundleCard's shape
// (border + name + meta + capability badges + actions) and
// replaces the flat-row `ModelCard` in Settings.tsx with a
// responsive grid rendering.

import { useState } from "react";
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

interface ModelGalleryCardProps {
  model: ModelSummary;
}

export default function ModelGalleryCard({ model }: ModelGalleryCardProps) {
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
            ? `Test passed${result.modelUsed ? ` · ${result.modelUsed}` : ""}`
            : result.message,
        });
      },
      onError: (err) => {
        setFeedback({
          ok: false,
          text: err instanceof Error ? err.message : "Test failed",
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
      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Header: name + apiFormat pill + status pills */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className={[
              "truncate text-base font-semibold",
              model.enabled
                ? "text-slate-900 dark:text-white"
                : "text-slate-400 dark:text-slate-500",
            ].join(" ")}
            title={model.displayName}
          >
            {model.displayName}
          </h3>
        </div>
        <span
          title="API format"
          className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          {model.apiFormat}
        </span>
      </div>

      {/* Status pills */}
      {(model.enabled === false ||
        (model.requiresKey && !model.credentialId) ||
        model.credentialId) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {!model.enabled && (
            <span
              data-testid={`model-card-status-disabled-${model.id}`}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            >
              Disabled
            </span>
          )}
          {model.requiresKey && !model.credentialId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              No credential
            </span>
          )}
          {model.credentialId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              <Check className="h-2.5 w-2.5" />
              Credential set
            </span>
          )}
        </div>
      )}

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
      <div className="mb-4 flex-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-mono" title={model.modelId}>
            {model.modelId}
          </span>
          {model.contextWindow !== undefined && (
            <span>{model.contextWindow.toLocaleString()} ctx</span>
          )}
          {model.maxOutputTokens !== undefined && (
            <span>{model.maxOutputTokens.toLocaleString()} out</span>
          )}
        </div>
        <div
          className="truncate font-mono text-[10px] text-slate-400 dark:text-slate-500"
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
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          ].join(" ")}
          data-testid={`model-card-feedback-${model.id}`}
        >
          {feedback.ok ? "✓ " : "✗ "}
          {feedback.text}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={model.enabled}
            onChange={handleToggleEnabled}
            data-testid={`model-card-enabled-${model.id}`}
            className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Enabled
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTest}
            disabled={testModel.isPending}
            title="Test model"
            data-testid={`model-card-test-${model.id}`}
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            {testModel.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setShowEdit(true)}
            title="Edit"
            data-testid={`model-card-edit-${model.id}`}
            className="rounded p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          {confirmingRemove ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Remove?
              </span>
              <button
                onClick={handleConfirmRemove}
                disabled={removeModel.isPending}
                data-testid={`model-card-confirm-remove-${model.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {removeModel.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Confirm
              </button>
              <button
                onClick={() => setConfirmingRemove(false)}
                disabled={removeModel.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              title="Remove"
              data-testid={`model-card-remove-${model.id}`}
              className="rounded p-1.5 text-slate-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
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
