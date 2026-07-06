# ADR-002: Desktop Remote Runtime Support

| Field       | Value                                    |
|-------------|------------------------------------------|
| **Number**  | ADR-002                                  |
| **Title**   | Desktop Remote Runtime Support           |
| **Status**  | Rewritten for ADR-041/042 (2026-07-05)   |
| **Date**    | 2026-06-07                               |
| **Last Updated** | 2026-07-05                         |
| **Depends On** | ADR-001-desktop (Desktop IPC vs CLI Shell-Out), ADR-041 (Principal-as-container), ADR-042 (no external session concept), ADR-035 (Tunnel Protocol) |
| **Related** | ADR-032 (Runtime Identity), ADR-002-pekohub (Remote Instance Management API), ADR-003-pekohub (Exposure Modes) |

---

> **2026-07-05 rewrite for ADR-041/042.** The original ADR-002 (pre-Principal
> model) described a remote Instance surface that no longer exists. The
> remote-addressable runtime actor is now the **Principal**, and the
> `peko log <PRINCIPAL>` IPC variant carries the activity feed across
> runtimes. The shape of this document otherwise holds.

## Context

Peko-desktop is a Tauri v2 + React + Vite desktop application for managing a Peko runtime. Per ADR-041 the only top-level runtime actor is the Principal; Agents are markdown prompt files inside a Principal and Sessions are internal JSONL storage (per ADR-042). This ADR now defines how remote runtime support preserves the local experience with the Principal as the addressable unit.

## Problem Statement

The desktop application assumes a single, local runtime. Users have requested the ability to manage principals running on remote machines — a home server accessed from a work laptop, or a VPS-hosted runtime managed from a local desktop. This ADR defines the architecture for adding remote runtime support while preserving the existing local-runtime experience.

1. Support multiple runtimes (local and remote) simultaneously.
2. Provide a unified UI where users interact with principals regardless of where the runtime lives.
3. Maintain transport transparency — the user should not need to think about *how* the desktop talks to a runtime, only *which* runtime a principal lives on.
4. Keep the local-runtime path fast and auth-free, while adding secure, authenticated access for remote runtimes.
5. Preserve the ADR-042 privacy gate (`caller == peer || caller == owner`) across runtimes — the remote path must not relax the contract.

## Decision

### Multi-Runtime Architecture

The desktop application maintains a list of **connected runtimes**. Each runtime is represented by a `RuntimeConnection` object that abstracts over the underlying transport.

```typescript
interface RuntimeConnection {
  id: string;              // runtime DID
  name: string;            // user-editable label
  type: 'local' | 'remote';
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  // For local
  ipc_path?: string;       // Unix socket path or UDP address
  // For remote
  pekohub_instance_url?: string;
}
```

The application state holds an array of these connections. At startup, the desktop attempts to auto-connect to:

1. The local runtime (existing behavior).
2. Any remote runtimes previously added by the user.

### Local Runtime (Existing Behavior Preserved)

The local runtime path remains unchanged:

- The desktop uses Tauri commands (`IpcClient`) to communicate with the local daemon.
- Auto-discovery via `PEKO_DAEMON_SOCK` environment variable or platform-default socket paths.
- Auto-start of the daemon if it is not running.
- No authentication layer — trust is OS-level.

### Remote Runtime (New)

Remote runtimes are accessed through the **pekohub API**, which proxies traffic through the tunnel defined in ADR-035.

The remote IPC contract mirrors the local `Principal*` packet set:

| Operation | Local (ADR-041 IPC) | Remote (PekoHub proxy) |
|-----------|--------------------|------------------------|
| List principals | `principal_list` | `GET /v1/runtimes/:id/principals` |
| Read principal | `principal_get` | `GET /v1/runtimes/:id/principals/:name` |
| Send message | `principal_send` / `principal_send_stream` | `POST /v1/runtimes/:id/principals/:name/send` (+ `/stream` SSE) |
| Read activity (ADR-042) | `principal_log --peer <subject>` | `GET /v1/runtimes/:id/principals/:name/log?peer=<subject>` |
| Set status / exposure | `principal_set_status` / `principal_set_exposure` | `PATCH /v1/runtimes/:id/principals/:name` |
| Grant / revoke permission | `principal_grant_permission` / `principal_revoke_permission` | `POST /v1/runtimes/:id/principals/:name/permit` |
| Publish (push) | `principal_push` | `POST /v1/runtimes/:id/principals/:name/publish` |
| Pull (install) | `principal_pull` | `POST /v1/runtimes/:id/pull` |

The privacy contract survives the proxy: PekoHub forwards `peer` as a Subject string and the runtime re-evaluates the privacy gate at the originating daemon. No relaxations are introduced at the proxy layer.

### Unified UI

The desktop UI presents **all principals from all connected runtimes** in a single sidebar. Transport details are hidden from the user.

- Each principal card shows a small indicator:
  - 💻 — local runtime
  - 🌐 — remote runtime
- Clicking a principal opens the chat view. The transport is transparent.
- The Settings page has a **Runtimes** section for adding, removing, and managing connections.

### Authentication

- The desktop app stores the pekohub access JWT in secure storage (Tauri `stronghold` or the OS keyring).
- JWT refresh uses pekohub's refresh-token rotation.
- All pekohub API calls include `Authorization: Bearer {jwt}`.
- The local runtime requires no auth token.

### Offline Handling

- If a remote runtime goes offline, its principals show an **offline** badge and the chat input is disabled.
- If the local runtime daemon stops, the existing offline behavior applies.
- **No message queuing** — if a runtime is unreachable, the user sees an error immediately and can retry.

## Architecture

### Frontend Hook Design

React hooks remain the primary abstraction. They accept a `runtimeId` parameter and internally dispatch to the correct Tauri command.

```typescript
// hooks/usePrincipals.ts
async function fetchPrincipals(runtimeId: string): Promise<PrincipalSummary[]> {
  return invoke<PrincipalSummary[]>('principal_list', { runtimeId });
}
```

The frontend does **not** branch on `type: 'local' | 'remote'` for IPC handlers — the runtimeId parameter is passed through and the local Rust layer resolves the transport.

### Privacy Gate — UI Layer (Strict, ADR-042)

The local `/log/$principalName` page (`peko log`) is the model for the privacy gate. For remote principals:

- The runtime echoes the caller's `Subject` (resolved via PekoHub's authenticated session).
- The originating daemon's `principal_log` enforces `caller == peer || caller == owner` plus the principal's `Chat` grant.
- The desktop UI:
  - Owner-root view if `caller == owner`.
  - "Read your own thread" toggle (peer self-read) for non-owners with a `Chat` grant.
  - Permission-denied state otherwise.
- **No UI affordance for an owner to read another peer's thread** — even though the runtime allows it under the same privacy contract. The remote UI mirrors the strict UI gate.

### Tauri Command Design

Rust commands inspect `AppState` to look up the runtime by `runtime_id` and dispatch to the appropriate transport implementation.

```rust
// src/commands/principal.rs
#[command]
pub async fn principal_log(
    name: String,
    peer: Option<String>,
    runtime_id: String,
    state: State<'_, AppState>,
) -> Result<LogResponse, Error> {
    let runtime = state.get_runtime(&runtime_id).await
        .ok_or(Error::RuntimeNotFound)?;
    match runtime.connection_type {
        RuntimeConnectionType::Local =>
            state.ipc_client.principal_log(&name, peer.as_deref()).await,
        RuntimeConnectionType::Remote =>
            state.pekohub_client.principal_log(&runtime_id, &name, peer.as_deref()).await,
    }
}
```

## UI/UX Changes

1. **Sidebar Principal List** — All principals from all connected runtimes appear in a single list. Each item shows the principal name, status, and a 💻/🌐 indicator.
2. **Principal Detail / Chat** — Owner-root or peer-self-read log; mirror the local privacy gate.
3. **Settings → Runtimes** — Add/remove/reconnect/rename local + remote runtimes; OAuth2 PKCE for PekoHub.
4. **Activity Log** — `/log/$principalName` works identically for local and remote principals.

## Reasoning

- **Unified command surface** keeps the frontend transport-agnostic. Branching happens once in Rust.
- **pekohub as the proxy** leverages existing tunnel infrastructure (ADR-035) and avoids exposing runtimes directly to the internet.
- **Secure token storage** via Tauri `stronghold`/keyring follows platform best practices.
- **No message queuing** keeps the implementation simple. Users get immediate feedback on connectivity.
- **Single sidebar** matches user mental models — they think about principals, not runtimes.
- **Privacy gate parity** between local and remote principals avoids an obvious regression — a remote stream that is *less* strict than local.

## Tradeoffs Accepted

| Tradeoff | Rationale |
|----------|-----------|
| Remote chat latency is higher than local IPC | Network round-trips; the tunnel protocol (ADR-035) mitigates with persistent connections. |
| Remote runtime requires pekohub account | Centralized identity and tunneling simplify security and NAT traversal. |
| No offline message queue | Simpler initial implementation. |
| Strict UI privacy gate (no owner override) | ADR-042's privacy contract is preserved; the runtime allows owner override but the UI deliberately does not surface it. |

## Alternatives Considered

1. **Direct TCP/UDP connection to remote runtime** — Rejected: requires exposing runtimes publicly or managing VPNs.
2. **Separate "Remote Mode" UI** — Rejected: fragments the user experience.
3. **GraphQL or gRPC instead of REST for pekohub** — Rejected: REST + SSE is already used in pekohub.
4. **Owner-override peer-read in the desktop UI** — Rejected: violates the "strict privacy gate" choice made for this migration. Operators who need to read another peer's thread use `peko principal permit ... --as <peer>` from the CLI on the owning runtime.

## Consequences

### Positive

- Users manage principals across multiple machines from a single desktop app.
- Architecture is extensible: new connection types only require a new `RuntimeConnectionType` variant.
- Frontend remains simple and transport-agnostic.
- Security centralized through pekohub's auth + tunnel.

### Negative

- Additional backend complexity (two transports to maintain).
- Remote features depend on pekohub availability.
- JWT management adds failure modes.

## Out of Scope (Future Work)

- **Bi-directional sync of full message history** between desktop and remote runtime.
- **Offline message queue / send-later** for remote runtimes.
- **LAN auto-discovery** of remote runtimes on the same network without pekohub.
- **Runtime-specific settings sync** (extensions, environment variables) across devices.

## Success Criteria

- [ ] User can sign into pekohub from the desktop app.
- [x] User can see principals from both local and remote runtimes in a single sidebar.
- [ ] User can chat with a remote principal with latency comparable to the web UI.
- [x] Local privacy gate (`owner-root | peer-self-read | permission denied`) is mirrored for remote principals.
- [x] Local runtime behavior is unchanged when no remote runtimes are configured.
- [x] JWT is never stored in plaintext.

## References

- [ADR-041 — Principal-as-container](../../../../peko-runtime/docs/architecture/adr/ADR-041-principal-as-container.md)
- [ADR-042 — No external session concept](../../../../peko-runtime/docs/architecture/adr/ADR-042-no-external-session-concept.md)
- [ADR-001-desktop — Desktop IPC vs CLI Shell-Out] (superseded; see footer)
- [ADR-035 — Tunnel Protocol]
- [ADR-032 — Runtime Identity]
- [Tauri v2 Security Best Practices](https://tauri.app/security/)

---

*End of ADR-002*
