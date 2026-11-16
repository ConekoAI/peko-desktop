/**
 * The starter seeds: the official seeds PekoHub publishes as `peko/<name>`
 * (`peko` is a handle no account can hold). The New peko form offers
 * them, so a first peko can start with a job without a file being
 * downloaded first.
 *
 * Read from the hub the app is set to use, without signing in. When the
 * hub can't be reached there are none, and the form works as it did.
 */

import { hubApiBase, hubGet, hubJson, hubSeed, settingsList } from "./api";

export const OFFICIAL_SEED_OWNER = "peko";

export interface StarterSeed {
  name: string;
  displayName: string;
  description: string | null;
  avatar: string | null;
}

async function hubUrl(): Promise<string> {
  const settings = await settingsList();
  return hubApiBase(settings.find((s) => s.key === "pekohub.base_url")?.value);
}

/** The official seeds, as the hub lists them. Rejects when it can't be read. */
export async function listStarterSeeds(): Promise<StarterSeed[]> {
  const hub = await hubUrl();
  const res = await hubGet(hub, "seeds", { query: { owner: OFFICIAL_SEED_OWNER, perPage: "12" } });
  if (!res.ok) throw new Error(`seeds: ${res.status}`);
  const body = (await hubJson(res, hub)) as { items?: unknown };
  if (!Array.isArray(body.items)) return [];
  return body.items.flatMap((item): StarterSeed[] => {
    const seed = item as Partial<StarterSeed> & { owner?: string };
    if (seed.owner !== OFFICIAL_SEED_OWNER || typeof seed.name !== "string") return [];
    return [
      {
        name: seed.name,
        displayName: seed.displayName || seed.name,
        description: seed.description ?? null,
        avatar: seed.avatar ?? null,
      },
    ];
  });
}

/** The text of the official seed `name`: what a `.seed.toml` download holds. */
export async function starterSeedText(name: string): Promise<string> {
  const res = await hubSeed(await hubUrl(), OFFICIAL_SEED_OWNER, name);
  if (!res.ok) throw new Error(`seed: ${res.status}`);
  return res.text();
}
