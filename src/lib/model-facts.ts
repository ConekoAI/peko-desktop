import type { DiscoveredModel, ModelFacts } from "../types";
import { EMPTY_PRICE_DRAFT, NO_MEDIA, type ModelInputs, type PriceDraft } from "./model-spec";

/** The effort levels peko sends, mildest first (runtime `ThinkingEffort`). */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The levels in a list that peko can send, mildest first. */
export function effortLevelsIn(names: readonly string[] | undefined): EffortLevel[] {
  const lower = (names ?? []).map((n) => n.toLowerCase());
  return EFFORT_LEVELS.filter((l) => lower.includes(l));
}

export function isEffortLevel(value: string | undefined): value is EffortLevel {
  return !!value && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/** Where a filled-in value came from. */
export type FactSource = "provider" | "suggested";

/**
 * What the add form fills in for a model picked from the endpoint's
 * list: the endpoint's own word first, then what models.dev suggests.
 * A part neither says stays empty (`source` absent).
 */
export interface Prefill {
  contextWindow: { value: string; source?: FactSource };
  maxOutput: { value: string; source?: FactSource };
  inputs: { value: ModelInputs; source?: FactSource };
  price: { value: PriceDraft; source?: FactSource };
  /** The effort levels the model takes; empty when not known. */
  effortLevels: { value: EffortLevel[]; source?: FactSource };
}

export const EMPTY_PREFILL: Prefill = {
  contextWindow: { value: "" },
  maxOutput: { value: "" },
  inputs: { value: NO_MEDIA },
  price: { value: EMPTY_PRICE_DRAFT },
  effortLevels: { value: [] },
};

function pick<T>(
  reported: ModelFacts,
  suggested: ModelFacts | undefined,
  read: (f: ModelFacts) => T | undefined,
): { value?: T; source?: FactSource } {
  const own = read(reported);
  if (own !== undefined) return { value: own, source: "provider" };
  const other = suggested ? read(suggested) : undefined;
  return other !== undefined ? { value: other, source: "suggested" } : {};
}

function inputsFrom(f: ModelFacts): ModelInputs | undefined {
  if (f.image_input === undefined && f.audio_input === undefined && f.video_input === undefined) {
    return undefined;
  }
  return { image: !!f.image_input, audio: !!f.audio_input, video: !!f.video_input };
}

function priceFrom(f: ModelFacts): PriceDraft | undefined {
  const p = f.pricing;
  if (!p || (p.input_per_million == null && p.output_per_million == null)) return undefined;
  const text = (n?: number) => (n != null ? String(n) : "");
  return {
    input: text(p.input_per_million),
    output: text(p.output_per_million),
    cacheRead: text(p.cache_read_per_million),
    cacheWrite: text(p.cache_write_per_million),
  };
}

export function prefillOf(model: DiscoveredModel | null | undefined): Prefill {
  if (!model) return EMPTY_PREFILL;
  const { reported, suggested } = model;
  const context = pick(reported, suggested, (f) => f.context_window);
  const output = pick(reported, suggested, (f) => f.max_output_tokens);
  const inputs = pick(reported, suggested, inputsFrom);
  const price = pick(reported, suggested, priceFrom);
  const levels = pick(reported, suggested, (f) => {
    const l = effortLevelsIn(f.thinking?.efforts);
    return l.length ? l : undefined;
  });
  return {
    contextWindow: { value: context.value ? String(context.value) : "", source: context.source },
    maxOutput: { value: output.value ? String(output.value) : "", source: output.source },
    inputs: { value: inputs.value ?? NO_MEDIA, source: inputs.source },
    price: { value: price.value ?? EMPTY_PRICE_DRAFT, source: price.source },
    effortLevels: { value: levels.value ?? [], source: levels.source },
  };
}

/** The sources a prefill used, each once. */
export function sourcesOf(prefill: Prefill): FactSource[] {
  const all = [
    prefill.contextWindow,
    prefill.maxOutput,
    prefill.inputs,
    prefill.price,
    prefill.effortLevels,
  ]
    .map((p) => p.source)
    .filter((s): s is FactSource => !!s);
  return (["provider", "suggested"] as const).filter((s) => all.includes(s));
}

/**
 * A token limit as typed: `undefined` when empty, `null` when not a
 * positive whole number.
 */
export function tokensFromText(raw: string): number | undefined | null {
  const t = raw.trim().replace(/[,_\s]/g, "");
  if (!t) return undefined;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 4_294_967_295 ? n : null;
}
