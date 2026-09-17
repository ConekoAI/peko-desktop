# ADR-003: Peko Realignment — peko Terminology, Hub URL Map, Security & Packaging Model

| Field       | Value                                    |
|-------------|------------------------------------------|
| **Number**  | ADR-003                                  |
| **Title**   | Peko Realignment                         |
| **Status**  | Accepted                                 |
| **Date**    | 2026-09-17                               |
| **Last Updated** | 2026-09-17                         |
| **Depends On** | ADR-002-desktop (Desktop Remote Runtime Support), peko-runtime ADR-054–060, pekohub ADR-005/006 |
| **Related** | ADR-001-desktop (superseded), ADR-041 (Principal-as-container), ADR-042 (no external session concept) |

---

## Context

Between 2026-09-13 and 2026-09-17, peko-runtime and pekohub pivoted their
designs. peko-desktop is still on the pre-pivot model: it calls hub URLs that
now **404 with no aliases**, sends IPC fields the runtime **removed**, and uses
"principal" throughout its UX. Four upstream pivots force this realignment:

1. **The PEKO model** — the actor users interact with is "a peko". The rename
   is user-facing only: the runtime's internal wire protocol, storage, and
   machine identifiers keep the `Principal` spelling
   ([ADR-059](../../../../peko-runtime/docs/architecture/adr/ADR-059-peko-as-user-facing-term.md) §6,
   [pekohub ADR-005](../../../../pekohub/docs/architecture/adr/ADR-005-peko-realignment.md)).
2. **The security model** — messaging is origin-signed
   ([ADR-058](../../../../peko-runtime/docs/architecture/adr/ADR-058-origin-signed-messaging.md))
   and there is a single attribution identity: the runtime derives the caller
   from the connection, so **caller-declared identity fields are gone**
   ([ADR-057](../../../../peko-runtime/docs/architecture/adr/ADR-057-single-attribution-identity.md)).
   Identities are self-certifying `did:key:z…`; legacy `did:peko:*` is dead
   (tolerated-but-unverified hub-side). Channel reads are membership-gated.
3. **The packaging model** — a peko's distributable forms are the **seed**
   (definition artifact; PekoHub is a seed-only registry —
   [ADR-060](../../../../peko-runtime/docs/architecture/adr/ADR-060-seed-as-the-definition-artifact.md),
   [pekohub ADR-006](../../../../pekohub/docs/architecture/adr/ADR-006-seed-terminology.md))
   and the **`.peko` package** (full-existence snapshot, private keys included —
   [ADR-056](../../../../peko-runtime/docs/architecture/adr/ADR-056-full-existence-principal-snapshot.md)).
   Creation runs the genesis pipeline with an observable `boot_state`
   ([ADR-054](../../../../peko-runtime/docs/architecture/adr/ADR-054-principal-genesis-pipeline.md)).
4. **The user-facing rename** — "principal" → "peko" in all copy, and the
   hub's peko-facing endpoints move from `…/principals…` to `…/pekos…` with
   **no backward-compatible aliases** (pekohub ADR-005).

## Decision

### Terminology rule (mirrors runtime ADR-059 §6)

- **UX + URLs say "peko" / "seed" / ".peko package".** All user-visible copy,
  frontend routes, hub URLs, share links, and deep links use the new terms.
- **Machine surfaces keep "principal".** Tauri command names
  (`principal_list`, …), TS/Rust type names (`PrincipalSummary`, …), IPC
  packet `type` strings (`principal_*`), JSON wire fields, storage files
  (`remote-principals.json`, chat-log paths, `~/.peko/principals/`), audit
  events, and component file names (e.g. `PrincipalSidebar.tsx`) are
  **not renamed**.
- **"Peko" as engine/brand is a separate, pre-existing sense and stays.**
  "Peko Desktop", "the Peko runtime/engine" already mean the daemon, not the
  actor. The actor is always "a peko" (lowercase, countable); copy must not
  place the two senses ambiguously in one string.

### Scope

Full alignment: in addition to the rename and the URL map, the desktop adopts
the new capabilities — the `private` exposure mode with single-exposure
conflict surfacing, the genesis/boot_state create flow, `.peko` export/import,
the seed install flow, the IPC breaking changes, and `sess:` display paths.

## Deltas

### Hub URL map (breaking — old paths 404)

| Old | New | Notes |
|-----|-----|-------|
| `GET /v1/public/principals/{owner}/{name}?token=` | `GET /v1/public/pekos/{owner}/{pekoName}?token=` | Response is `{ liveInstance: { id, publicName, description, owner, capabilities, status, tosRequired, tosText } }`; mapped into the internal (still "principal"-named) resolve result. |
| `POST /v1/public/principals/{owner}/{name}/chat` | `POST /v1/public/pekos/{owner}/{pekoName}/chat` | SSE contract unchanged (`data: {chunk,done}`, `event: iteration\|error`). **428 + tosText** (ToS-required) is surfaced as a specific chat error state. |
| `GET /v1/me/accessible-principals` | `GET /v1/me/accessible-pekos` | Response is `{ pekos: [{ id, ownerName, pekoName, publicName, status }] }` (`principalName` → `pekoName` on the wire). Now owner-only + `exposure='private'` semantics; the "Shared with me" grouping is re-labeled accordingly. |
| Share link `/p/{owner}/{name}` | `/peko/{owner}/{name}` | Legacy `/p/...` links are still parsed on input (hub keeps a redirect); only the new form is emitted. |
| Deep link `peko://add-principal?url=…` | `peko://add-peko?url=…` | Both forms accepted on receipt; only the new form emitted. |
| `https://pekohub.org/api/v1/search` | unchanged | Registry search path stays; response shape re-verified against `SearchResult`/`BundleItem`. |

Frontend routes (visible in the URL bar — they count as URLs) move with the
same rule: `/principal/$principalName` → `/peko/$pekoName`,
`/chat/$principalName` → `/chat/$pekoName`,
`/log/$principalName` → `/log/$pekoName`. The generated
`routeTree.gen.ts` is regenerated by the router plugin, never hand-edited.

### IPC deltas (runtime ADR-057/058)

Packet `type` strings keep their `principal_*` spelling — they are machine
surface and are deliberately **not** renamed. The payloads change:

1. **No caller-declared identity**: `"user": "local"` is dropped from
   `principal_send` and `principal_send_stream` request builders; identity is
   server-derived.
2. **ChannelPost `sender_name`**: omitted (speak as self) or a peko name —
   never `user:<id>` (the runtime refuses with `[forbidden]`).
3. **ChannelPeek**: the `requester` field is removed; optional
   `tail`/`before`/`query`/`author` filters may be adopted. Reads are
   membership-gated, so permission errors are handled in the UI.
4. **ChannelCreate/Leave/Members/List**: verified against current packets;
   `ChannelMembers`/`ChannelList` are gated and `[forbidden]` errors are
   surfaced in the Channels UI.
5. **PrincipalExport** slimmed to `{name, output}` — no
   `include_sessions`/`with_extensions`/`full_snapshot` flags.
6. **DID forms**: accept/display self-certifying `did:key:z…` everywhere a
   DID is parsed; legacy `did:peko:*` / `prin_` forms are dead. The internal
   `principal:<did>` peer kind keeps its spelling.
7. **Session display paths** render with the `sess:` scheme prefix
   (`sess:/a/b/c`); bare `/a/b/c` remains accepted on input.
8. The desktop must not strip or forge identity headers; any
   `x-pekohub-user-id` / `x-pekohub-caller-principal` usage is removed.
   (PoP registration, bridge tokens, dual-signed channel events, and socket
   permissions are runtime-side — the sidecar daemon owns them.)

### Exposure model — fourth mode `private`

- Modes are now `unexposed | private | unlisted | public` (was 3). Picker
  copy: **private** = "only you (owner) and invited pekos",
  **unlisted** = "anyone with the link", **public** = "discoverable",
  **unexposed** = "local only".
- Setting `public`/`unlisted` on a DID that already has a public/unlisted
  instance returns **409 Conflict** `{ error, conflictingInstanceId }`; the
  desktop shows a specific dialog ("This peko is already exposed elsewhere")
  instead of a generic error.

### Packaging & create flow

- **Seed registry UX**: PekoHub is a seed-only registry; the artifact noun is
  "seed". The install flow is "Pull seed" → "Create peko from seed"
  (`peko create my-peko -s <name>.seed.toml`, matching hub `/seeds` copy).
  Create-from-seed is CLI-local: the runtime's `principal_create` IPC packet
  has no seed field, so the desktop's `principal_create` command rejects a
  `Some(seed)` loudly with the grounding command, and after a pull the
  Registry page shows a "Create your peko from this seed" panel with the
  copyable CLI command plus a refresh button (`principal_reload` +
  principals-list invalidation) that picks up the peko once the CLI create
  lands — no in-app create button. **410 Gone** (retired lanes/kinds) gets
  clear copy.
- **`.peko` export/import UI**: export lives in the profile modal with a
  **key-sensitivity warning** — the package contains the peko's private
  keys (full existence, ADR-056). No Tauri dialog plugin is available in
  this build, so both directions use validated text inputs (export
  pre-fills `~/.peko/exports/<name>.peko` and requires a `.peko`
  suffix; import takes the package path). Copy distinguishes "wake" an
  existing peko (same identity) from "grow" a fresh one from a seed;
  keyless packages surface the runtime's "ground it with `peko create`"
  guidance verbatim. The desktop's `principal_import` command runs
  `principal_reload` itself after a local import (runtime requirement),
  so the UI only invalidates the principals list.
- **Genesis-aware create flow** (ADR-054): `peko create` blocks through
  genesis (300s cap), which the desktop's 10s IPC request timeout would kill.
  For `principal_create` specifically, the request timeout is extended (or
  replaced with a poll loop) on the new `boot_state` field:
  `provisioned → defined → genesis_pending → organized`. The modal shows a
  progress state ("Waking your peko… this can take a minute"), `boot_state`
  is added to `PrincipalSummary`/config types, and `genesis_pending` is
  surfaced in the sidebar row.
- **CLI hints in copy**: `peko principal new` → `peko create`;
  `peko principal permit …` → `peko permit …`; `peko log <PRINCIPAL>` →
  `peko log <PEKO>`.

## Alternatives Considered

1. **Rename the machine surfaces too** (Tauri commands, IPC strings, storage
   files) — Rejected: mirrors the runtime's own rule (ADR-059 §6). Renaming
   wire strings and storage would add migration risk for zero user benefit.
2. **Keep calling the old hub URLs and alias client-side** — Impossible: the
   hub 404s the old paths with no aliases; there is nothing to alias to.
3. **Partial alignment (URLs only, skip the new capabilities)** — Rejected:
   `private` exposure, genesis-aware create, and `.peko` packages are
   user-facing runtime features; a desktop that cannot surface them is
   functionally behind the runtime it ships with.

## Consequences

### What breaks for existing users

- **Nothing storage-side.** `remote-principals.json`, `~/.peko/principals/`,
  chat-log paths, and all local state are untouched; no migration runs.
- **Old hub URLs 404 with no aliases.** A desktop built with the old paths
  cannot resolve public peko pages, remote chat, or the accessible-pekos
  list — the desktop **must ship with the new URLs**; there is no graceful
  degradation for older builds against the current hub.
- **IPC field removals.** Builds that still send `user` on
  `principal_send{,_stream}` or `requester` on `ChannelPeek` are talking to a
  runtime that no longer honors those fields; the realigned desktop pairs
  with the realigned sidecar runtime.
- **Inbound compatibility is kept where the hub/runtime keep it**: legacy
  `/p/...` share links and `peko://add-principal` deep links still parse;
  bare session paths are still accepted on input.
- Docs, screenshots, and copy that say "principal" are stale UX-wise.

### Deliberately unchanged

- Tauri command names, TS/Rust type names, IPC packet `type` strings
  (`principal_*`), JSON wire fields, storage paths/files, audit-event names,
  and component file names.
- OCI wire values (`org.peko.kind="principal"`, `/v1/bundles/*`,
  `/v1/principals/by-*`).
- The `https://pekohub.org/api/v1/search` registry endpoint.
- Engine/brand usage of "Peko" (Peko Desktop, the Peko runtime/engine).
- The SSE chat contract and the ADR-042 privacy gate as surfaced in the UI.

## References

- [ADR-054 — Principal genesis pipeline](../../../../peko-runtime/docs/architecture/adr/ADR-054-principal-genesis-pipeline.md)
- [ADR-055 — Principal kb](../../../../peko-runtime/docs/architecture/adr/ADR-055-principal-kb.md)
- [ADR-056 — Full-existence principal snapshot](../../../../peko-runtime/docs/architecture/adr/ADR-056-full-existence-principal-snapshot.md)
- [ADR-057 — Single attribution identity](../../../../peko-runtime/docs/architecture/adr/ADR-057-single-attribution-identity.md)
- [ADR-058 — Origin-signed messaging](../../../../peko-runtime/docs/architecture/adr/ADR-058-origin-signed-messaging.md)
- [ADR-059 — peko as the user-facing term](../../../../peko-runtime/docs/architecture/adr/ADR-059-peko-as-user-facing-term.md)
- [ADR-060 — Seed as the definition artifact](../../../../peko-runtime/docs/architecture/adr/ADR-060-seed-as-the-definition-artifact.md) (accepted 2026-09-17; merged to master as peko-runtime PR #399)
- [pekohub ADR-005 — Peko realignment](../../../../pekohub/docs/architecture/adr/ADR-005-peko-realignment.md)
- [pekohub ADR-006 — Seed terminology](../../../../pekohub/docs/architecture/adr/ADR-006-seed-terminology.md)
- [ADR-002-desktop — Desktop Remote Runtime Support](ADR-002-desktop-remote-runtime-support.md) (amended by this ADR)
- `src-tauri/src/clients/pekohub.rs`, `src-tauri/src/clients/hub_remote_client.rs` — hub URL call sites
- `src-tauri/src/ipc/mod.rs` — IPC bridge (packet strings unchanged; payloads per above)

---

*End of ADR-003*
