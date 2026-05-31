# Pre-Migration Checklist: CLI Shell-Out → Direct IPC

**Status**: In Progress  
**Date**: 2026-05-31  
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
| Teams | 🔄 Pending | Page exists, needs wiring to `useTeams` |
| Team Detail | 🔄 Pending | Needs implementation |
| Sessions | 🔄 Pending | Needs implementation |
| Session Detail | 🔄 Pending | Needs implementation |
| Extensions | 🔄 Pending | Needs implementation |
| Registry | 🔄 Pending | Needs implementation |
| Cron | 🔄 Pending | Needs implementation |
| Settings | ✅ Done | General, daemon, credentials, about tabs |
| Chat | 🔄 Pending | Needs IPC streaming integration |

**Why it blocks**: We need a working baseline. If IPC migration breaks something, we can bisect against the CLI version.

---

## 2. Integration Tests for CLI Shell-Out

**Definition of Done**: `cargo test` in `src-tauri/` has tests that verify `run_peko_json` and `run_peko_ok` against a real `peko` binary (or a mock binary).

**Test cases needed**:
- `run_peko_json` parses valid JSON output
- `run_peko_json` returns error on non-zero exit code
- `run_peko_ok` returns trimmed stdout on success
- `run_peko_ok` returns stderr on failure
- `run_peko` with `--json` flag is passed correctly
- Binary discovery falls through sidecar → PATH `peko` → PATH `pekobot`
- Windows `CREATE_NO_WINDOW` flag is set

**Why it blocks**: These tests become the contract that IPC must satisfy. When we migrate, we replace the CLI call with an IPC call and the test should still pass.

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
pub struct RequestHeader {
    pub protocol_version: u16,  // e.g., 1
    pub request_id: u64,
}

// Daemon response to unknown packet type
ResponsePacket::Error {
    request_id,
    message: "Unknown packet type or unsupported protocol version".to_string(),
}
```

**Why it blocks**: Old desktop clients must not crash against new daemons, and new desktop clients must get a clear error against old daemons.

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

---

## 6. Settings / Credentials Stable

**Definition of Done**: `settings_get/set` and `credential_get/set/delete` work correctly and will not change during migration.

**Current implementation**:
- `settings_get/set`: Direct TOML read/write of `~/.peko/config.toml`
- `credential_get/set/delete`: OS keyring via `keyring` crate (service="peko", account=provider)

**Verification**:
- Settings persist across app restarts
- Credentials are stored securely and retrieved correctly
- No dependency on CLI or IPC for these operations

**Why it blocks**: These are already implemented correctly (direct file + keyring). They should not change during migration, so we verify they're stable now.

---

## 7. Registry Search Stable

**Definition of Done**: `registry_search` works via HTTP to `pekohub.org` and is independent of the IPC migration.

**Current implementation**:
- HTTP GET to `https://pekohub.org/api/v1/search?q={query}&page={page}&perPage={per_page}`
- `registry_pull` shells out to `peko agent pull <ref>`

**Why it blocks**: Registry search is already using HTTP (not CLI or IPC). It should continue working unchanged during migration.

---

## 8. Streaming Chat Fully Working

**Definition of Done**: A user can open the chat page, select an agent, send a message, and receive a streaming response via IPC.

**Current state**:
- `IpcClient::execute()` sends `RequestPacket::Execute` and emits Tauri events
- Frontend `useIpcStream` hook listens for events
- Chat UI page exists but may not be fully wired

**Work needed**:
- Wire `useIpcStream` to the actual chat message input
- Handle stream events: `Text`, `ToolCall`, `ToolResult`, `Done`, `Error`
- Display streaming text with typing indicator
- Handle reconnection if daemon restarts mid-stream
- Test with real agent and real daemon

**Why it blocks**: Streaming chat is the hardest IPC path. If it works reliably, the simpler CRUD packets will too.

---

## 9. Daemon Auto-Start Reliable

**Definition of Done**: The desktop app can start the daemon automatically when needed, and the daemon is ready to accept IPC connections within 10 seconds.

**Current implementation**:
- `daemon::start()` spawns `peko daemon start` and waits for PID file
- `ConnectionManager::connect()` (in peko-runtime CLI) auto-starts daemon
- Desktop app has `daemon_start()` command but may not auto-start

**Work needed**:
- Desktop app should attempt auto-start when daemon is not running
- Retry logic with exponential backoff
- Clear error message if auto-start fails
- Tray menu "Start Daemon" should work reliably

**Why it blocks**: Once we depend on IPC for everything, the daemon must be running. Auto-start must be rock-solid.

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
| 1 | All desktop pages functional | 🔄 In Progress | P0 |
| 2 | Integration tests for CLI shell-out | 🔄 Pending | P1 |
| 3 | Frontend E2E tests | 🔄 Pending | P1 |
| 4 | IPC protocol versioning | 🔄 Pending | P1 |
| 5 | Error handling standardization | 🔄 Pending | P1 |
| 6 | Settings/credentials stable | ✅ Done | P0 |
| 7 | Registry search stable | ✅ Done | P0 |
| 8 | Streaming chat fully working | 🔄 In Progress | P0 |
| 9 | Daemon auto-start reliable | 🔄 In Progress | P0 |
| 10 | Performance baseline | 🔄 Pending | P2 |

**Estimated time to complete all blockers**: 2–3 weeks of focused work.

**Order of operations**:
1. Finish all desktop pages (item 1) — this is the current milestone
2. Wire streaming chat end-to-end (item 8)
3. Harden daemon auto-start (item 9)
4. Add integration tests (item 2) and E2E tests (item 3)
5. Standardize error handling (item 5) and add protocol versioning (item 4)
6. Collect performance baseline (item 10)
7. **Begin IPC protocol extension (Phase 2)**

---

*Last updated: 2026-05-31*
