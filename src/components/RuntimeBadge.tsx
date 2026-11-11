import { Monitor, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * PR-1 channel UI primitive. Visual reuse of the runtime
 * provenance pattern already established by `PrincipalSidebar.tsx`:
 * `Monitor` for local, `Globe` for remote. Kept tiny + dependency-
 * free so it slots into ChannelHeader / MemberList
 * without lifting any state.
 *
 * Not a Zustand/TanStack-Query consumer — it renders whatever the
 * caller passes. Cross-runtime semantics live in the channel IPC
 * wrappers (`runtimeId: string | null` → routes through
 * `HubRemoteClient` in PR #5; `null` resolves to "local").
 */
export default function RuntimeBadge({
  runtimeId,
  size = "sm",
  showLabel = false,
}: {
  runtimeId: string;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const isLocal = runtimeId === "local";
  const Icon = isLocal ? Monitor : Globe;
  const sizeClass = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const label = isLocal ? t("layout.runtimeBadge.localRuntime") : runtimeId;

  return (
    <span
      className="inline-flex items-center gap-1 text-fg-muted"
      data-testid={`runtime-badge-${runtimeId}`}
      title={label}
    >
      <Icon className={sizeClass} aria-hidden="true" />
      {showLabel && (
        <span className="text-[10px] font-medium uppercase tracking-wider">
          {isLocal ? t("layout.runtimeBadge.local") : runtimeId}
        </span>
      )}
    </span>
  );
}