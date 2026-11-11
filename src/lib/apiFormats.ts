import { t } from "../i18n";

/**
 * The wire protocols the runtime has adapters for (ADR-068). The values
 * are the short ids the runtime lists models with and accepts on add:
 * `openai` → OpenAI Chat Completions, `anthropic` → Anthropic Messages,
 * `responses` → OpenAI Responses.
 */
export type ApiFormat = "openai" | "anthropic" | "responses";

export const API_FORMATS: readonly ApiFormat[] = ["openai", "anthropic", "responses"];

function known(value: string): value is ApiFormat {
  return (API_FORMATS as readonly string[]).includes(value);
}

export function apiFormatLabel(value: string): string {
  return known(value) ? t(`models.apiFormat.${value}.label`) : value;
}

/** A short label for badges, e.g. "Chat Completions". */
export function apiFormatShort(value: string): string {
  return known(value) ? t(`models.apiFormat.${value}.short`) : value;
}

/** What the format is for and the request it makes. */
export function apiFormatHint(value: string): string {
  return known(value) ? t(`models.apiFormat.${value}.hint`) : "";
}
