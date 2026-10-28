/**
 * The wire protocols the runtime has adapters for (ADR-068). The values
 * are the short ids the runtime lists models with and accepts on add:
 * `openai` → OpenAI Chat Completions, `anthropic` → Anthropic Messages,
 * `responses` → OpenAI Responses.
 */
export type ApiFormat = "openai" | "anthropic" | "responses";

export const API_FORMATS: { value: ApiFormat; label: string; short: string; hint: string }[] = [
  {
    value: "openai",
    label: "OpenAI-compatible (Chat Completions)",
    short: "Chat Completions",
    hint: "Most providers and local servers: POST {base URL}/chat/completions",
  },
  {
    value: "anthropic",
    label: "Anthropic-compatible (Messages)",
    short: "Anthropic Messages",
    hint: "Anthropic and compatible gateways: POST {base URL}/v1/messages",
  },
  {
    value: "responses",
    label: "OpenAI Responses",
    short: "Responses",
    hint: "OpenAI's newer API: POST {base URL}/responses",
  },
];

export function apiFormatLabel(value: string): string {
  return API_FORMATS.find((f) => f.value === value)?.label ?? value;
}

/** A short label for badges, e.g. "Chat Completions". */
export function apiFormatShort(value: string): string {
  return API_FORMATS.find((f) => f.value === value)?.short ?? value;
}
