import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Fingerprint } from "lucide-react";
import { useTranslation } from "react-i18next";
import { identityCode } from "../lib/api";

/**
 * An identity's code (runtime ADR-112): thirty digits two owners read to
 * each other. Shown in groups, selectable, with a copy button.
 */
export function IdentityCodeView({
  code,
  label,
  hint,
  testId,
}: {
  code: string;
  label: string;
  hint?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Fingerprint className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="flex items-center gap-2">
        <code
          className="select-all font-mono text-sm tracking-wide text-fg"
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {code}
        </code>
        <button
          type="button"
          onClick={copy}
          className="btn-icon h-6 w-6"
          aria-label={copied ? t("common.copied") : t("common.copy")}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

/** The code of `of` as this computer holds it, or nothing until it is known. */
export function IdentityCodeRow({
  of,
  label,
  hint,
  unknown,
  testId,
}: {
  of: string;
  label: string;
  hint?: string;
  /** Said when this computer has not met it yet; nothing is shown without it. */
  unknown?: string;
  testId?: string;
}) {
  const { data } = useQuery({
    queryKey: ["identity-code", of],
    queryFn: () => identityCode(of),
    staleTime: 60_000,
  });
  if (!data) return null;
  if (!data.code) {
    return unknown ? (
      <p className="text-xs text-fg-subtle" data-testid={testId}>
        {unknown}
      </p>
    ) : null;
  }
  return <IdentityCodeView code={data.code} label={label} hint={hint} testId={testId} />;
}
