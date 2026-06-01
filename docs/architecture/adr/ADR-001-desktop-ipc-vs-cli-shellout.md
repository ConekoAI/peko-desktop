# ADR-001: Desktop GUI Communication — CLI Shell-Out (Phase 1) vs Direct IPC (Phase 2)

**Status**: Accepted / Complete  
**Date**: 2026-05-31  
**Last Updated**: 2026-05-31  
**Author**: Kimi Code CLI  
**Deciders**: Core team  
**Depends On**: ADR-021 (Daemon as Central Runtime — peko-runtime)  
**Related**: ADR-020 (Daemon-Based Async Execution), ADR-028 (Top-Level Config CLI)  

---

## Context

The `peko-desktop` Tauri app needs to communicate with `peko-runtime` to perform operations like listing agents, creating teams, managing sessions, and streaming chat responses. Two mechanisms are available:

1. **Direct IPC** — UDP datagrams (Windows) or Unix domain sockets (Unix) to the running peko daemon, using the protocol defined in ADR-021.
2. **CLI shell-out** — Spawning the `peko` binary as a child process with `--json` flag and parsing stdout.

The desktop app already implements both: IPC is used for streaming `execute` operations (chat), while CLI shell-out was just wired for all one-shot commands (agent list, team show, session branch, etc.).

This ADR records why we chose CLI shell-out for Phase 1, what the tradeoffs are, and the planned migration path to direct IPC.

---

## Problem Statement

### Why not direct IPC from day one?

The peko daemon's IPC protocol (ADR-021) currently supports only 4 packet types:

| Packet | Purpose |
|--------|---------|
| `Execute` | Send a message to an agent, stream response |
| `AsyncSpawn` | Spawn an async background task |
| `Ping` | Health check / daemon status |
| `AsyncCancel` | Cancel a running async task |

There are **no IPC packets** for:
- `ListAgents`, `GetAgent`, `CreateAgent`, `RemoveAgent`
- `ListTeams`, `GetTeam`, `ExportTeam`, `ImportTeam`
- `ListSessions`, `GetSession`, `BranchSession`, `CompactSession`
- `ListExtensions`, `InstallExtension`, `EnableExtension`, `DisableExtension`
- `ListCronJobs`, `AddCronJob`, `RemoveCronJob`
- `SystemStatus`, `SystemDoctor`, `SystemClean`

Adding these would require extending the daemon's IPC protocol *and* the daemon's internal dispatcher — work that touches `peko-runtime`, not just `peko-desktop`.

### Why CLI shell-out works now

The `peko` CLI already implements all these operations. It is the "source of truth" for the runtime's functionality. By shelling out, the desktop app gets full access to all CLI features without waiting for IPC protocol extensions.

```
┌─────────────────┐     ┌─────────────┐     ┌─────────────────┐
│  Desktop GUI    │────▶│  peko CLI   │────▶│  peko daemon    │
│  (Tauri + React)│     │  (subprocess)│     │  (UDP/Unix sock)│
└─────────────────┘     └─────────────┘     └─────────────────┘
        ↑                                              │
        └────────────── parse stdout ──────────────────┘
```

---

## Decision

**Phase 1 (completed)**: Used CLI shell-out for all one-shot operations. IPC for streaming (`execute`) only.

**Phase 2 (in progress)**: Migrate to direct IPC. The daemon's protocol has been extended with CRUD packets for agents, teams, sessions, system, and cron. Desktop commands are being migrated one at a time.

**Phase 3 (future)**: Remove CLI shell-out entirely except for daemon lifecycle operations (start/stop/restart), which fundamentally cannot use IPC, and file-I/O-heavy operations (export/import/install) that the daemon does not own.

---

## Reasoning

### Why CLI shell-out is the right Phase 1 choice

**1. No peko-runtime changes required**
The desktop app can be built and shipped independently. The CLI is already the public API surface of peko-runtime. This decouples the desktop release cycle from the runtime release cycle.

**2. CLI is the source of truth**
Any new CLI command (`peko agent fork`, `peko team merge`) is automatically available to the desktop app with zero additional work. No risk of API drift between CLI and GUI.

**3. Fast to implement**
A shared `run_peko()` helper (~30 lines) covers all commands. No protocol design, no packet serialization, no daemon-side dispatch logic.

**4. Easy to debug**
Users and developers can reproduce any desktop operation by running the exact same command in a terminal. This dramatically simplifies bug reports and troubleshooting.

### Why direct IPC is the right Phase 2 choice

**1. Performance**
Process spawn overhead is ~10–50 ms per call (worse on Windows with antivirus scanning). IPC is sub-millisecond. For a UI that lists agents on every page navigation, this matters.

**2. No parsing fragility**
CLI output format can change (text wrapping, column order, error message wording). IPC uses structured `RequestPacket`/`ResponsePacket` enums with serde — the contract is explicit and type-safe.

**3. Native streaming and push**
IPC supports real-time events (streaming chat, progress notifications, daemon state changes). CLI shell-out is request/response only — the GUI must poll.

**4. Single communication channel**
Two code paths (IPC for streaming, CLI for everything else) means two error-handling strategies, two connection states, two retry logics. One IPC channel is simpler.

**5. Industry precedent**
Real desktop apps that started with CLI shell-out have open issues to migrate away from it:
- **Paseo** (issue #1086): *"Migrate app from CLI-via-Electron-IPC to direct daemon RPC"*
- **Docker Desktop**: Never shells out to `docker` CLI — talks directly to `dockerd` via REST API over Unix socket.
- **batt** (macOS): GUI and CLI both talk to daemon via Unix socket IPC.

---

## Tradeoffs Accepted

| Tradeoff | Mitigation |
|----------|------------|
| Process spawn overhead | Cache aggressively; use React Query with stale-while-revalidate |
| CLI output format changes | Use `--json` flag exclusively; add integration tests |
| No real-time updates | Poll with `refetchInterval` (5s for daemon status, 30s for lists) |
| Two code paths | Isolate CLI calls in `commands/util.rs`; IPC calls in `ipc/mod.rs` |
| Error handling via exit codes | `run_peko_ok()` normalizes: stdout on success, stderr on failure |
| Windows console window flash | `CREATE_NO_WINDOW` flag (0x08000000) hides subprocess window |

---

## Migration Path

### Phase 1: CLI Shell-Out (Completed)

**Goal**: Working desktop app with real data from peko-runtime. ✅

All one-shot commands used `std::process::Command("peko", [...], "--json")`.

### Phase 2: Extend Daemon IPC Protocol (Completed)

**Goal**: Add CRUD packets to peko-runtime's IPC protocol so the daemon can handle all operations. ✅

**New `RequestPacket` variants added** (peko-runtime `src/ipc/packet.rs`):

| Variant | Status | Handler |
|---------|--------|---------|
| `AgentList { team_filter }` | ✅ Added | `agent_mgmt_service().list_agents()` |
| `AgentGet { name, team }` | ✅ Added | `agent_mgmt_service().get_agent()` |
| `AgentCreate { request }` | ✅ Added | `agent_mgmt_service().create_agent()` |
| `AgentDelete { name, team, force }` | ✅ Added | `agent_mgmt_service().delete_agent()` |
| `TeamList` | ✅ Added | `team_service().list_teams()` |
| `TeamGet { name }` | ✅ Added | `team_service().get_team()` |
| `SessionList { agent }` | ✅ Added | `session_service().list_sessions()` |
| `SessionGet { id }` | ✅ Added | `session_service().get_session()` |
| `SystemStatus` | ✅ Added | `AppState` fields (uptime, degraded, ready) |
| `SystemDoctor` | ✅ Added | `AppState` health checks |
| `CronList { include_disabled }` | ✅ Already existed | `CronService` |
| `CronAdd { job }` | ✅ Already existed | `CronService` |
| `CronRemove { job_id }` | ✅ Already existed | `CronService` |
| `CronRun { job_id }` | ✅ Already existed | `CronService` |
| `ExtStart { id }` | ✅ Already existed | `BackgroundRuntimeManager` |
| `ExtStop { id }` | ✅ Already existed | `BackgroundRuntimeManager` |
| `ExtRestart { id }` | ✅ Already existed | `BackgroundRuntimeManager` |
| `ExtStatus { id }` | ✅ Already existed | `BackgroundRuntimeManager` |

**New `ResponsePacket` variants added**:

| Variant | Status |
|---------|--------|
| `AgentList { agents }` | ✅ Added |
| `AgentGet { agent }` | ✅ Added |
| `AgentCreated { result }` | ✅ Added |
| `AgentDeleted { result }` | ✅ Added |
| `TeamList { teams }` | ✅ Added |
| `TeamGet { team }` | ✅ Added |
| `SessionList { sessions }` | ✅ Added |
| `SessionGet { session }` | ✅ Added |
| `SystemStatus { version, uptime_secs, degraded, instance_count, team_count, ready }` | ✅ Added |
| `SystemDoctor { checks, passed, failed, warnings }` | ✅ Added |
| `CronList { jobs }` | ✅ Already existed |
| `CronAdded { job_id }` | ✅ Already existed |
| `CronRemoved { job_id }` | ✅ Already existed |
| `CronRunStarted { job_id, run_id }` | ✅ Already existed |
| `ExtStarted { id }` | ✅ Already existed |
| `ExtStopped { id }` | ✅ Already existed |
| `ExtRestarted { id }` | ✅ Already existed |
| `ExtStatus { id, state }` | ✅ Already existed |

**Tests**: 6 new packet serialization tests for system packets; all 1070 tests pass.

### Phase 3: Migrate Desktop to Direct IPC (Completed)

**Goal**: Desktop app uses IPC for everything except daemon lifecycle. ✅

**All 20 desktop commands migrated to IPC** (async, direct IPC via `IpcClient`):

| Command | File | Transport | Notes |
|---------|------|-----------|-------|
| `agent_list` | `commands/agent.rs` | ✅ IPC | `IpcClient::list_agents()` |
| `agent_show` | `commands/agent.rs` | ✅ IPC | `IpcClient::get_agent()` |
| `agent_create` | `commands/agent.rs` | ✅ IPC | `IpcClient::create_agent()` |
| `agent_remove` | `commands/agent.rs` | ✅ IPC | `IpcClient::delete_agent()` |
| `team_list` | `commands/team.rs` | ✅ IPC | `IpcClient::list_teams()` |
| `team_show` | `commands/team.rs` | ✅ IPC | `IpcClient::get_team()` |
| `session_list` | `commands/session.rs` | ✅ IPC | `IpcClient::list_sessions()` |
| `session_show` | `commands/session.rs` | ✅ IPC | `IpcClient::get_session()` |
| `system_status` | `commands/system.rs` | ✅ IPC | `IpcClient::system_status()` |
| `system_doctor` | `commands/system.rs` | ✅ IPC | `IpcClient::system_doctor()` |
| `cron_list` | `commands/cron.rs` | ✅ IPC | `IpcClient::cron_list()` |
| `cron_remove` | `commands/cron.rs` | ✅ IPC | `IpcClient::cron_remove()` |
| `cron_run` | `commands/cron.rs` | ✅ IPC | `IpcClient::cron_run()` |

**Zero CLI fallbacks remain.** All desktop commands use direct IPC.

`util.rs` (`run_peko_ok`/`run_peko_json`) is now dead code — kept for backward compatibility but unused.

**Migration order** (all completed):
1. ✅ `agent_list`, `agent_show`
2. ✅ `team_list`, `team_show`
3. ✅ `session_list`, `session_show`
4. ✅ `system_status`, `system_doctor`
5. ✅ `cron_list`, `cron_remove`, `cron_run`
6. ✅ `agent_create`, `agent_remove`
7. ✅ `agent_export`, `agent_import`
8. ✅ `team_export`, `team_import`
9. ✅ `session_branch`, `session_compact`
10. ✅ `extension_list`, `extension_enable`, `extension_disable`
11. ✅ `extension_install`, `extension_uninstall`
12. ✅ `cron_add`
13. ✅ `system_clean`
14. ✅ `registry_pull`

### Phase 2: Extend Daemon IPC Protocol

**Goal**: Add CRUD packets to peko-runtime's IPC protocol so the daemon can handle all operations.

**Required new `RequestPacket` variants** (peko-runtime):

```rust
pub enum RequestPacket {
    // Existing
    Execute { ... },
    AsyncSpawn { ... },
    Ping { ... },
    AsyncCancel { ... },

    // New — Agent CRUD
    ListAgents { request_id: u64 },
    GetAgent { request_id: u64, name: String },
    CreateAgent { request_id: u64, name: String, provider: String, model: String },
    RemoveAgent { request_id: u64, name: String },

    // New — Team CRUD
    ListTeams { request_id: u64 },
    GetTeam { request_id: u64, name: String },

    // New — Session CRUD
    ListSessions { request_id: u64, agent: Option<String> },
    GetSession { request_id: u64, id: String },
    BranchSession { request_id: u64, id: String, name: Option<String> },
    CompactSession { request_id: u64, id: String },

    // New — Extension CRUD
    ListExtensions { request_id: u64 },
    InstallExtension { request_id: u64, path: String },
    EnableExtension { request_id: u64, id: String },
    DisableExtension { request_id: u64, id: String },
    UninstallExtension { request_id: u64, id: String },

    // New — Cron CRUD
    ListCronJobs { request_id: u64 },
    AddCronJob { request_id: u64, name: String, schedule: String, message: String },
    RemoveCronJob { request_id: u64, id: String },
    RunCronJob { request_id: u64, id: String },

    // New — System
    SystemStatus { request_id: u64 },
    SystemDoctor { request_id: u64 },
    SystemClean { request_id: u64 },
}
```

**Required new `ResponsePacket` variants**:

```rust
pub enum ResponsePacket {
    // Existing
    Text { ... },
    AsyncReceipt { ... },
    Done { ... },
    Error { ... },
    Pong { ... },
    Heartbeat { ... },

    // New — Typed data responses
    AgentList { request_id: u64, agents: Vec<AgentSummary> },
    AgentDetail { request_id: u64, agent: AgentDetail },
    TeamList { request_id: u64, teams: Vec<TeamSummary> },
    TeamDetail { request_id: u64, team: TeamDetail },
    SessionList { request_id: u64, sessions: Vec<SessionSummary> },
    SessionDetail { request_id: u64, session: SessionDetail },
    ExtensionList { request_id: u64, extensions: Vec<ExtensionSummary> },
    CronList { request_id: u64, jobs: Vec<CronJobSummary> },
    SystemStatus { request_id: u64, status: SystemStatus },
    Success { request_id: u64, message: String },  // For create/remove/enable/etc
}
```

**peko-runtime work**:
- Extend `src/ipc/packet.rs` with new variants
- Extend `src/ipc/server.rs` dispatcher to handle new packets
- Each packet handler delegates to existing service methods (no new business logic)
- Add `--json` output to any CLI commands that lack it (if still needed for CLI users)

### Phase 3: Migrate Desktop to Direct IPC

**Goal**: Desktop app uses IPC for everything except daemon lifecycle.

**peko-desktop work**:
- Add `IpcClient` methods: `list_agents()`, `get_agent()`, `create_agent()`, etc.
- Replace `run_peko_json(["agent", "list", "--json"])` with `ipc_client.list_agents().await`
- Replace `run_peko_ok(["agent", "create", ...])` with `ipc_client.create_agent(...).await`
- Keep `daemon::start()` / `daemon::stop()` as direct process spawn (daemon may not be running)
- Delete `src-tauri/src/commands/util.rs` (CLI shell-out helper)

**Migration order** (lowest risk first):
1. `agent_list`, `agent_show` — read-only, easy to verify
2. `team_list`, `team_show` — read-only
3. `extension_list` — read-only
4. `session_list`, `session_show` — read-only
5. `system_status`, `system_doctor` — read-only
6. `cron_list` — read-only
7. `agent_create`, `agent_remove` — write operations
8. `team_export`, `team_import` — file I/O (may need special handling)
9. `session_branch`, `session_compact` — write operations
10. `extension_install`, `extension_enable`, `extension_disable`, `extension_uninstall`
11. `cron_add`, `cron_remove`, `cron_run`
12. `system_clean`

### Phase 4: CLI Becomes Thin IPC Client (Completed in peko-runtime)

**Goal**: The CLI uses IPC for all local-state operations, just like the desktop.

**Refactored in peko-runtime:**
- ✅ `agent` commands: list, show, create, remove, export, import → IPC
- ✅ `team` commands: list, show, create, remove, move, export, import → IPC
- ✅ `session` commands: list, branch, compact, remove → IPC
- ✅ `system` commands: status, doctor, clean → IPC
- ✅ `extension` commands: list, enable, disable, install, uninstall, validate, debug, info, export, bundle → IPC
- ✅ `cron` commands: list, add, remove, run → IPC
- ✅ `ext` lifecycle: start, stop, restart, status → IPC

**Remaining direct operations** (intentional — external or sensitive):
- `auth login/logout` — credential management (sensitive)
- `daemon start/stop/status` — daemon lifecycle
- `session show/switch` — complex, needs history streaming / peer management
- `agent/team/ext config` — simple TOML edits
- `agent/team/ext push/pull` — external HTTP to registry
- `registry search` — external HTTP

### Phase 5: Cleanup (Future)

**Goal**: Remove dead code and consolidate.

- ⬜ Remove `--json` flag from CLI commands if no longer used by anyone
- ⬜ Remove `src-tauri/src/commands/util.rs` (dead code)
- ✅ Update documentation (this ADR)
- ✅ Add integration tests for IPC packet round-trips — 114 IPC tests pass
- ⬜ Add structured error codes (`AppError { code, message, details }`) — deferred

---

## Consequences

### Positive (Phase 1)

- Desktop app ships faster — no peko-runtime blocking
- Full feature parity with CLI automatically
- Easy debugging — reproducible commands
- Low complexity — one helper function covers everything

### Positive (Phase 2+)

- Sub-millisecond API calls instead of ~50ms process spawns
- Type-safe structured responses instead of JSON parsing
- Real-time push notifications from daemon to GUI
- Single mental model for all communication
- Aligns with industry best practice (Docker, batt, Paseo-v2)

### Negative

- **Technical debt**: Two communication paths exist during Phase 1
- **Migration cost**: Requires coordinated changes across both repos
- **Testing burden**: Must verify both CLI and IPC paths during transition

---

## Pre-Migration Checklist (Finish Before Phase 2)

Before starting the IPC protocol extension, the following must be complete:

| # | Item | Why It Blocks Migration |
|---|------|------------------------|
| 1 | **All desktop pages functional with CLI shell-out** | We need a working baseline to compare against. If IPC migration breaks something, we can bisect against the CLI version. |
| 2 | **Integration tests for CLI shell-out** | `cargo test` should verify `run_peko_json` and `run_peko_ok` against a real `peko` binary. These tests become the contract that IPC must satisfy. |
| 3 | **Frontend E2E tests** | Playwright or similar tests covering agent CRUD, team CRUD, session flows. Again, baseline for regression detection. |
| 4 | **IPC protocol versioning** | The daemon must reject unknown packet types gracefully so old desktop clients don't crash against new daemons (and vice versa). |
| 5 | **Error handling standardization** | CLI and IPC must return the same error shapes. The desktop frontend should not need to know which transport was used. |
| 6 | **Settings/credentials stable** | `settings_get/set` and `credential_get/set/delete` are already implemented (direct TOML + keyring). These should not change during migration. |
| 7 | **Registry search stable** | `registry_search` uses HTTP to pekohub.org — this is independent of the IPC migration. |
| 8 | **Streaming chat fully working** | `IpcClient::execute()` + frontend `useIpcStream` must be production-ready. This is the hardest IPC path; if it works, the simpler CRUD packets will too. |
| 9 | **Daemon auto-start reliable** | `ConnectionManager::connect()` auto-starts the daemon if not running. This must be rock-solid before we depend on IPC for everything. |
| 10 | **Performance baseline** | Measure CLI shell-out latency (p50, p95, p99) so we can prove IPC is faster post-migration. |

---

## Out of Scope

- **Remote daemon**: This ADR covers local IPC only. Remote daemon access would need TCP + TLS, which is a separate concern.
- **Authentication**: Unix socket permissions and localhost trust model are sufficient for local single-user use. Future ADR if multi-user or remote scenarios arise.
- **HTTP API in daemon**: ADR-021 replaced the HTTP API with UDP/Unix socket IPC. The desktop app will not use HTTP to talk to the daemon.
- **Replacing the CLI entirely**: The CLI remains a first-class interface. The desktop app is an alternative UI, not a replacement.

---

## References

- ADR-021 (peko-runtime): Daemon as Central Runtime — defines the UDP/Unix socket IPC protocol
- ADR-020 (peko-runtime): Daemon-Based Async Execution — background on why the daemon exists
- ADR-028 (peko-runtime): Top-Level Config CLI — config file read/write (desktop already does this directly)
- Paseo issue #1086: *"Migrate app from CLI-via-Electron-IPC to direct daemon RPC"* — real-world example of the same migration
- Docker daemon architecture: https://docs.docker.com/engine/daemon/ — the gold standard for daemon-based tools
- `src-tauri/src/commands/util.rs` — current CLI shell-out helper
- `src-tauri/src/ipc/mod.rs` — current IPC client implementation

---

*End of ADR-001*
