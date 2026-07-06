# Post-Migration Checklist: Desktop aligned to ADR-041 / ADR-042

**Status**: ✅ Completed (PR #X, 2026-07-05)  
**Date**: 2026-07-05  
**Last Updated**: 2026-07-05  
**Related**: [ADR-041](../../../../peko-runtime/docs/architecture/adr/ADR-041-principal-as-container.md), [ADR-042](../../../../peko-runtime/docs/architecture/adr/ADR-042-no-external-session-concept.md)

This document tracks the desktop's post-migration state after
alignment to the Principal-as-container design. The pre-Principal
checklist (CLI shell-out → direct IPC migration) is preserved for
history but no longer accurate; the table below is the source of
truth for the v0 launch surface.

---

## 1. Pages Functional on Post-#125 Runtime

**Definition of Done**: Every page renders real data from the
post-#125 runtime over direct IPC and matches the
Principal/PrincipalLog terminology.

| Page | Status | Notes |
|------|--------|-------|
| Dashboard | ✅ Done | Counts principals (not agents); New Principal CTA points to CLI |
| Chat | ✅ Done | Per-principal thread (`/chat/$principalName`); no session toolbar; streams via `principal_send_stream` |
| Principal Log (ADR-042) | ✅ Done | `/log/$principalName` with privacy gate (owner-root, peer self-read toggle, or permission denied) |
| Daemon Log | ✅ Done | `/daemon-logs` — operator surface, renamed from `/logs` |
| Shared with Me | ✅ Done | Lists shared principals via `shared_instances_list` |
| Extensions | ✅ Done | Unchanged |
| Registry | ✅ Done | Unchanged |
| Cron | ✅ Done | Unchanged |
| Settings | ✅ Done | Unchanged |
| Events Bus | ✅ Done | Unchanged |
| ~~Sessions~~ / ~~Session Detail~~ | ✅ Deleted | ADR-042; no `peko session` surface. Routes removed. |

**Why this matters**: the pre-Principal desktop had full Sessions /
Session-Detail pages wired to retired IPC variants. With the runtime
on `Principal*` packets, those pages would have been broken at first
launch. They are deleted rather than left as dead surfaces.

**Completed**: 2026-07-05

---

## 2. IPC Bridge Aligned to `Principal*` Packets

**Definition of Done**: Every Tauri command invokes an IPC variant
that exists on the runtime side. The retired `agent_*` /
`session_*` / `team_*` / `execute` shim are gone from the bridge.

| Capability | Bridge command | Runtime IPC packet | Status |
|---|---|---|---|
| List principals | `principal_list` | `principal_list` | ✅ |
| Read principal | `principal_get` | `principal_get` | ⬜ (post-launch) |
| Send (sync) | `principal_send` | `principal_send` | ✅ |
| Send (stream) | `principal_send_stream` | `principal_send_stream` | ✅ |
| Activity log (ADR-042) | `principal_log` | `principal_log` | ✅ |
| Provider catalog | `principal_provider_list` | `principal_provider_list` | ✅ |
| Set status / exposure | `principal_set_status` / `principal_set_exposure` | same | ⬜ (post-launch) |
| Permission grant / revoke | `principal_grant_permission` / `principal_revoke_permission` | same | ⬜ (post-launch) |
| Push / pull (PekoHub publish) | `principal_push` / `principal_pull` | same | ⬜ (post-launch) |

**Completed (v0 launch surface)**: 2026-07-05

---

## 3. Frontend Terminology Migrated

**Definition of Done**: No user-visible string references the retired
Agent / Team / Sessions concepts. File names and component names match
the runtime's vocabulary.

| Old | New |
|---|---|
| `AgentSidebar` | `PrincipalSidebar` |
| `TeamRail` | `AppRail` |
| `CreateAgentModal` | `CreatePrincipalModal` (CLI guidance) |
| `AgentProfileModal` | `PrincipalProfileModal` (slim — fields `principal_list` returns) |
| `/chat/$agentName` | `/chat/$principalName` |
| `/chat/$agentName/$sessionId` | *(deleted)* |
| `/sessions`, `/sessions/$id` | *(deleted)* |
| `/logs` | `/daemon-logs` |

**Completed**: 2026-07-05

---

## 4. Privacy Gate Surfaced (ADR-042)

**Definition of Done**: The `/log/$principalName` page reflects the
runtime's privacy contract in three states:

- **Owner**: `caller == principal.owner` → owner-root activity feed,
  no peer dropdown.
- **Peer with `Chat` grant**: toggle to read the caller's own thread
  (`peer = user:<caller>`). No other peer's thread is reachable from
  the UI.
- **Otherwise**: permission-denied affordance with a CLI hint
  (`peko principal permit <name> user:<you> chat`).

The runtime's privacy contract is:
`(caller == peer) || (caller == principal.owner)`
plus the principal's `Chat` permission grant.

The desktop's UI does not surface a "read another peer's thread"
affordance even though the runtime allows it under the same privacy
contract, to avoid making the strict gate look accidental in the UI.

**Completed**: 2026-07-05

---

## 5. Build & Test Status

- **peko-runtime**: pre-#125 contracts landed (`PrincipalLog` IPC,
  privacy gate).
- **peko-desktop**:
  - `cargo check` (Rust bridge) → clean (0 errors, 0 warnings).
  - `npm run type-check` (TypeScript) → pending — see `Verify`.
  - `npm run build` (Vite production build) → pending.
  - `npm run test` (Vitest) → pending.

**Completed**: pending the `Verify` task in this PR.

---

## Summary

| # | Item | Status |
|---|------|--------|
| 1 | Pages functional on post-#125 runtime | ✅ |
| 2 | IPC bridge aligned to `Principal*` packets | ✅ (v0 launch surface) |
| 3 | Frontend terminology migrated | ✅ |
| 4 | Privacy gate surfaced | ✅ |
| 5 | Build & test green | 🔄 pending `Verify` |

**Pre-launch constraint**: no backward compatibility. The pre-#125
desktop surface (e.g., `/chat/$agentName/$sessionId`,
`/sessions`, `agent_*` commands) is gone in this PR, not aliased.

---

*Last updated: 2026-07-05*
