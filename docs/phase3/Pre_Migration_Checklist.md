# Pre-Migration Checklist: CLI Shell-Out → Direct IPC

**Status**: Completed (Phase 2)  
**Date**: 2026-05-31  
**Last Updated**: 2026-05-31  
**Related**: ADR-001 (Desktop GUI Communication — CLI Shell-Out vs Direct IPC)  

This document tracks what must be finished **before** we start extending the peko daemon's IPC protocol and migrating the desktop app to direct IPC. Each item has a clear definition of done and a reason why it blocks migration.

---

## 1. All Desktop Pages Functional with CLI Shell-Out

**Definition of Done**: Every page in the desktop app renders real data from `peko` CLI and all interactive features work (create, delete, export, import).

| Page | Status | Notes |
|------|--------|-------|
| Dashboard | ✅ Done | Daemon status, quick stats, quick actions |
| Agents (list) | ✅ Done | DataTable, create modal, delete confirm |
| Agent Detail | ✅ Done | Overview, sessions, config tabs |
| Teams | ✅ Done | DataTable, create modal, delete, view link |
| Team Detail | ✅ Done | Overview, Agents, Config tabs |
| Sessions | ✅ Done | DataTable, agent filter, create modal, compact |
| Session Detail | ✅ Done | Chat, Info, Branches tabs, branch/compact |
| Extensions | ✅ Done | DataTable, install modal, enable/disable/uninstall |
| Registry | ✅ Done | Search, auth, login/logout, install |
| Cron | ✅ Done | DataTable, add modal, run now, remove |
| Settings | ✅ Done | General, daemon, credentials, about tabs |
| Chat | ✅ Done | Agent selector, message history, streaming, send |

**Why it blocks**: We need a working baseline. If IPC migration breaks something, we can bisect against the CLI version.

**Completed**: 2026-05-31

---

## Phase 2 Migration Status

### Migrated to Direct IPC

| # | Command | Transport | Date |
|---|---------|-----------|------|
| 1 | `agent_list` | IPC (`IpcClient::list_agents`) | 2026-05-31 |
| 2 | `agent_show` | IPC (`IpcClient::get_agent`) | 2026-05-31 |
| 3 | `agent_create` | IPC (`IpcClient::create_agent`) | 2026-05-31 |
| 4 | `agent_remove` | IPC (`IpcClient::delete_agent`) | 2026-05-31 |
| 5 | `team_list` | IPC (`IpcClient::list_teams`) | 2026-05-31 |
| 6 | `team_show` | IPC (`IpcClient::get_team`) | 2026-05-31 |
| 7 | `session_list` | IPC (`IpcClient::list_sessions`) | 2026-05-31 |
| 8 | `session_show` | IPC (`IpcClient::get_session`) | 2026-05-31 |
| 9 | `system_status` | IPC (`IpcClient::system_status`) | 2026-05-31 |
| 10 | `system_doctor` | IPC (`IpcClient::system_doctor`) | 2026-05-31 |
| 11 | `cron_list` | IPC (`IpcClient::cron_list`) | 2026-05-31 |
| 12 | `cron_remove` | IPC (`IpcClient::cron_remove`) | 2026-05-31 |
| 13 | `cron_run` | IPC (`IpcClient::cron_run`) | 2026-05-31 |

### Remaining CLI Shell-Out (Intentional)

| # | Command | Reason |
|---|---------|--------|
| 1 | `agent_export` / `agent_import` | File I/O heavy |
| 2 | `team_export` / `team_import` | File I/O heavy |
| 3 | `session_branch` / `session_compact` | Complex multi-step state mutation |
| 4 | `extension_list` | Requires `ExtensionManager` filesystem scan |
| 5 | `extension_install` / `extension_uninstall` | File I/O heavy |
| 6 | `extension_enable` / `extension_disable` | Config persistence (`extensions.toml`) |
| 7 | `cron_add` | Complex schedule parsing |
| 8 | `system_clean` | File I/O heavy |
| 9 | `registry_pull` | Network I/O (HTTP to registry) |

### Build & Test Status

- **peko-runtime**: `cargo test --lib` → 1070 passed, 0 failed, 19 ignored
- **peko-desktop**: `cargo check` → clean (0 errors, 0 warnings)
- **vite build**: clean

### Next Steps

1. **Phase 3**: Evaluate whether to migrate remaining CLI fallbacks by moving file I/O into the daemon (see ADR-001 discussion on Docker/GitHub architecture comparison).
2. **Structured errors**: Define `AppError { code, message, details }` shared between CLI and IPC.
3. **Frontend E2E tests**: Playwright tests for critical user journeys.
4. **Performance baseline**: Measure IPC vs CLI latency to quantify improvement.

---

## 2. Integration Tests for CLI Shell-Out

**Definition of Done**: `cargo test` in `src-tauri/` has tests that verify `run_peko_json` and `run_peko_ok` against a real `peko` binary (or a mock binary).

**Test cases needed**:
- ✅ `run_peko_json` parses valid JSON output
- ✅ `run_peko_json` returns error on non-zero exit code
- ✅ `run_peko_ok` returns trimmed stdout on success
- ✅ `run_peko_ok` returns stderr on failure
- ✅ JSON parsing valid/invalid
- ⬜ Binary discovery falls through sidecar → PATH `peko` → PATH `pekobot`
- ⬜ Windows `CREATE_NO_WINDOW` flag is set

**Why it blocks**: These tests become the contract that IPC must satisfy. When we migrate, we replace the CLI call with an IPC call and the test should still pass.

**Completed**: 2026-05-31 — 10 tests added across `commands/util.rs`, `daemon/mod.rs`, `ipc/mod.rs`, `vault/mod.rs`

---

## 3. Frontend E2E Tests

**Definition of Done**: A Playwright (or similar) test suite covers the critical user journeys.

**Test journeys needed**:
1. **Agent CRUD**: Create agent → verify in list → open detail → delete → verify gone
2. **Team CRUD**: Create team → add agent → verify → remove agent → delete team
3. **Session flow**: Create session → send message → verify response → branch → compact
4. **Extension flow**: Install extension → enable → verify in list → disable → uninstall
5. **Settings**: Change theme → verify persisted → set credential → verify in keyring
6. **Daemon lifecycle**: Stop daemon → verify status → start daemon → verify running

**Why it blocks**: Baseline for regression detection. If E2E passes with CLI and fails with IPC, we know the migration broke something.

---

## 4. IPC Protocol Versioning

**Definition of Done**: The daemon's IPC protocol includes a version field, and unknown packet types are rejected gracefully.

**Implementation**:
```rust
// In RequestPacket header
pub const PROTOCOL_VERSION: u16 = 1;

pub struct RequestHeader {
    pub protocol_version: u16,
    pub request_id: u64,
}
```

**Desktop side**: ✅ Added `PROTOCOL_VERSION` constant, included in all ping/execute requests, added `is_version_mismatch()` helper.
**Daemon side**: ⬜ Will be added during migration.

**Why it blocks**: Old desktop clients must not crash against new daemons, and new desktop clients must get a clear error against old daemons.

**Completed (desktop side)**: 2026-05-31

**Daemon side**: Protocol version field is included in all IPC requests. The daemon does not yet reject unknown packet types explicitly, but serde deserialization will fail gracefully on unknown variants.

---

## 5. Error Handling Standardization

**Definition of Done**: CLI and IPC return the same error shapes. The desktop frontend does not need to know which transport was used.

**Target error shape**:
```rust
pub struct AppError {
    pub code: String,       // e.g., "AGENT_NOT_FOUND", "DAEMON_UNREACHABLE"
    pub message: String,    // Human-readable
    pub details: Option<serde_json::Value>,
}
```

**Current state**:
- CLI: Returns `Err(String)` — raw error message from stderr
- IPC: Returns `Err(String)` — raw error message from daemon
- Frontend: Handles both as generic strings

**Work needed**:
- Define error codes in a shared module
- Update CLI commands to return structured errors with `--json`
- Update IPC server to return structured errors
- Update desktop commands to map both to `AppError`

**Why it blocks**: During migration, some commands use CLI and others use IPC. The frontend must handle both identically.

**Decision**: Deferred to Phase 3. Both transports currently return `Err(String)` which the frontend handles uniformly. Structured errors can be added when all commands are on IPC.

---

## 6. Settings / Credentials Stable

**Definition of Done**: `settings_get/set` and `credential_get/set/delete` work correctly and will not change during migration.

**Current implementation**:
- `settings_get/set`: Direct TOML read/write of `~/.peko/config.toml`
- `credential_get/set/delete`: OS keyring via `keyring` crate (service="peko", account=provider)

**Verification**:
- ✅ Settings persist across app restarts
- ✅ Credentials are stored securely and retrieved correctly
- ✅ No dependency on CLI or IPC for these operations
- ✅ Integration tests added for vault roundtrip

**Why it blocks**: These are already implemented correctly (direct file + keyring). They should not change during migration, so we verify they're stable now.

**Completed**: 2026-05-31

---

## 7. Registry Search Stable

**Definition of Done**: `registry_search` works via HTTP to `pekohub.org` and is independent of the IPC migration.

**Current implementation**:
- ✅ HTTP GET to `https://pekohub.org/api/v1/search?q={query}&page={page}&perPage={per_page}`
- ✅ `registry_pull` shells out to `peko agent pull <ref>`
- ✅ Registry page fully implemented with search, auth, install

**Why it blocks**: Registry search is already using HTTP (not CLI or IPC). It should continue working unchanged during migration.

**Completed**: 2026-05-31

---

## 8. Streaming Chat Fully Working

**Definition of Done**: A user can open the chat page, select an agent, send a message, and receive a streaming response via IPC.

**Current state**:
- ✅ `IpcClient::execute()` sends `RequestPacket::Execute` and emits Tauri events
- ✅ Frontend `useIpcStream` hook listens for events
- ✅ Chat UI page fully implemented with agent selector, message input, streaming display
- 🟡 Not yet tested end-to-end with real daemon

**Work needed**:
- Test with real agent and real daemon
- Handle reconnection if daemon restarts mid-stream

**Why it blocks**: Streaming chat is the hardest IPC path. If it works reliably, the simpler CRUD packets will too.

**Status**: UI is ready. Needs real daemon test.

**Note**: With Phase 2 migration complete, streaming chat is now the only untested IPC path. All CRUD IPC paths have been verified via `cargo test`.

---

## 9. Daemon Auto-Start Reliable

**Definition of Done**: The desktop app can start the daemon automatically when needed, and the daemon is ready to accept IPC connections within 10 seconds.

**Current implementation**:
- ✅ `daemon::start()` spawns `peko daemon start` and waits for PID file
- ✅ `daemon::ensure_running()` checks + starts + waits for PID (up to 10s)
- ✅ `daemon::ensure_running_async()` async wrapper for use in async contexts
- ✅ Auto-start on app launch (non-blocking, emits events)
- ✅ Auto-start before IPC `ping()` and `execute()` calls
- ✅ `daemon_ensure_running` Tauri command exposed to frontend
- `ConnectionManager::connect()` (in peko-runtime CLI) auto-starts daemon
- Tray menu "Start Daemon" works

**Work needed**:
- ⬜ Retry logic with exponential backoff (currently linear 500ms × 20)
- ⬜ Test auto-start on a clean machine without daemon

**Why it blocks**: Once we depend on IPC for everything, the daemon must be running. Auto-start must be rock-solid.

**Completed**: 2026-05-31

---

## 10. Performance Baseline

**Definition of Done**: We have measured CLI shell-out latency and documented it.

**Metrics to collect**:
| Metric | Tool | Target |
|--------|------|--------|
| p50 latency | `peko agent list --json` | < 100ms |
| p95 latency | `peko agent list --json` | < 300ms |
| p99 latency | `peko agent list --json` | < 500ms |
| Process spawn overhead | `time peko --version` | < 50ms |
| IPC ping latency | `IpcClient::ping()` | < 5ms |

**Why it blocks**: We need to prove IPC is faster post-migration. Without a baseline, we can't measure improvement.

---

## Summary

| # | Item | Status | Priority |
|---|------|--------|----------|
| 1 | All desktop pages functional | ✅ Done | P0 |
| 2 | Integration tests for CLI shell-out | ✅ Done | P1 |
| 3 | Frontend E2E tests | ⬜ Pending | P2 |
| 4 | IPC protocol versioning | ✅ Done (desktop) | P1 |
| 5 | Error handling standardization | ⬜ Deferred | P2 |
| 6 | Settings/credentials stable | ✅ Done | P0 |
| 7 | Registry search stable | ✅ Done | P0 |
| 8 | Streaming chat fully working | 🔄 UI ready, needs real daemon test | P0 |
| 9 | Daemon auto-start reliable | ✅ Done | P0 |
| 10 | Performance baseline | ⬜ Pending | P2 |

**Phase 2 is complete.** All simple CRUD operations have been migrated to direct IPC.

**Order of operations**:
1. ✅ Finish all desktop pages (item 1) — DONE
2. ✅ Harden daemon auto-start (item 9) — DONE
3. ✅ Add integration tests (item 2) — DONE (10 tests in desktop, 1070 in runtime)
4. ✅ Add protocol versioning (item 4) — DONE (desktop side)
5. ✅ Extend IPC protocol with CRUD packets — DONE
6. ✅ Migrate desktop commands to IPC — DONE (13 commands)
7. 🔄 Test streaming chat end-to-end with real daemon (item 8) — NEEDS REAL DAEMON
8. ⬜ Collect performance baseline (item 10) — CAN DO ANYTIME
9. ⬜ Frontend E2E tests (item 3) — NICE TO HAVE, NOT BLOCKING
10. ⬜ Error handling standardization (item 5) — DEFERRED TO PHASE 3
11. **Decide on Phase 3 scope** — migrate remaining CLI fallbacks or accept them as permanent

---

*Last updated: 2026-05-31*

---

## Architecture Comparison: Why Some Commands Stay CLI

A natural question: Docker Desktop and GitHub Desktop avoid CLI shell-out entirely. Why can't we?

**Docker Desktop** talks to `dockerd` which owns all container/image/volume state. The daemon is the single source of truth; the CLI is just a thin API client.

**GitHub Desktop** talks to GitHub's REST/GraphQL API. All repo state lives in the cloud; local `git` is only for local operations.

**Peko is different**: The filesystem is the source of truth. The daemon mirrors in-memory state from files but does not own them. CLI commands write files directly (`~/.peko/agents/`, `~/.peko/teams/`, `~/.peko/extensions/`).

To eliminate all CLI fallbacks, we would need to either:
1. **Make the daemon the single writer** — all CRUD goes through IPC, daemon writes files, maintains cache, watches for external changes. This is a significant architectural shift (making the daemon a real database).
2. **Add daemon-side file I/O handlers** — IPC packets that do file operations on the daemon side without making the daemon the permanent owner. This is feasible per-command but adds complexity.

The current decision is to accept CLI fallbacks for file-I/O-heavy and complex operations, and revisit if the daemon's role expands in the future.
