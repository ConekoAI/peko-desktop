# ADR-002: Desktop Remote Runtime Support

| Field       | Value                                    |
|-------------|------------------------------------------|
| **Number**  | ADR-002                                  |
| **Title**   | Desktop Remote Runtime Support           |
| **Status**  | Proposed                                 |
| **Date**    | 2026-06-07                               |
| **Depends On** | ADR-001-desktop (Desktop IPC vs CLI Shell-Out), ADR-035 (Tunnel Protocol) |
| **Related** | ADR-032 (Runtime Identity), ADR-036 (Remote Instance Management), ADR-037 (Exposure Modes) |

---

## Context

Peko-desktop is a Tauri v2 + React + Vite desktop application for managing Pekobot agents. Today, it exclusively communicates with a local peko-runtime daemon via IPC (UDP/Unix socket), as established in ADR-001-desktop. Users have requested the ability to manage agents running on remote machines — for example, a home server accessed from a work laptop, or a VPS-hosted runtime managed from a local desktop. This ADR defines the architecture for adding remote runtime support while preserving the existing local-runtime experience.

## Problem Statement

The desktop application currently assumes a single, local runtime. We need to:

1. Support multiple runtimes (local and remote) simultaneously.
2. Provide a unified UI where users can interact with agents regardless of where the runtime lives.
3. Maintain transport transparency — the user should not need to think about *how* the desktop talks to a runtime, only *which* runtime an agent lives on.
4. Keep the local-runtime path fast and auth-free, while adding secure, authenticated access for remote runtimes.

## Decision

### Multi-Runtime Architecture

The desktop application will maintain a list of **connected runtimes**. Each runtime is represented by a `RuntimeConnection` object that abstracts over the underlying transport.

```typescript
interface RuntimeConnection {
  id: string;              // runtime DID
  name: string;            // user-editable label
  type: 'local' | 'remote';
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  // For local
  ipc_path?: string;       // Unix socket path or UDP address
  // For remote
  pekohub_instance_url?: string;  // e.g., /v1/instances?runtime=...
}
```

The application state holds an array of these connections. At startup, the desktop attempts to auto-connect to:

1. The local runtime (existing behavior).
2. Any remote runtimes previously added by the user.

### Local Runtime (Existing Behavior Preserved)

The local runtime path remains unchanged:

- The desktop uses Tauri commands (`ipc_client`) to communicate with the local daemon.
- Auto-discovery via `PEKO_DAEMON_SOCK` environment variable or platform-default socket paths.
- Auto-start of the daemon if it is not running.
- No authentication layer — trust is OS-level (the user already has shell access).

### Remote Runtime (New)

Remote runtimes are accessed through the **pekohub API**, which proxies traffic through the tunnel defined in ADR-035.

**Flow:**

1. User signs into their pekohub account from the desktop app.
2. Desktop fetches the list of runtimes registered to the account via `GET /v1/runtimes`.
3. For each runtime, instances are fetched via `GET /v1/instances?runtime_id={runtime_id}`.
4. Chat and management operations are sent through pekohub's proxy endpoints:
   - `POST /v1/instances/:id/chat` — send a message.
   - `GET /v1/instances/:id/stream` — receive SSE stream.
   - Management operations (create agent, enable extension, etc.) go through the corresponding pekohub API routes, which tunnel to the runtime.

### Unified UI

The desktop UI presents **all agents from all connected runtimes** in a single sidebar. Transport details are hidden from the user.

- Each agent card shows a small indicator:
  - 💻 — local runtime
  - 🌐 — remote runtime
- Clicking an agent opens the chat view. The transport is transparent.
- The Settings page gains a **Runtimes** section for adding, removing, and managing connections.

### Authentication

- The desktop app stores the pekohub access JWT in secure storage (Tauri `stronghold` or the OS keyring).
- JWT refresh uses pekohub's refresh-token rotation (see ADR-001-pekohub).
- All pekohub API calls include `Authorization: Bearer {jwt}`.
- The local runtime requires no auth token.

### Offline Handling

- If a remote runtime goes offline, its agents show an **offline** badge and the chat input is disabled.
- If the local runtime daemon stops, the existing offline behavior applies.
- **No message queuing** — if a runtime is unreachable, the user sees an error immediately and can retry.
- **Caching**: the last agent list and recent messages are cached locally (SQLite via Tauri SQL plugin or `localStorage` for lightweight data) so the UI remains usable in read-only mode while disconnected.

### Switching Contexts

- Users may have multiple runtimes connected at the same time.
- When creating a new agent, a **runtime selector** in the creation modal lets the user choose which runtime hosts the agent.
- The **default runtime** is the local one if available; otherwise, the most recently used runtime.

## Architecture

### Frontend Hook Design

React hooks remain the primary abstraction. They accept a `runtimeId` parameter and internally dispatch to the correct Tauri command.

```typescript
// hooks/useInstances.ts
import { invoke } from '@tauri-apps/api/core';
import { useQuery } from '@tanstack/react-query';

interface Instance {
  id: string;
  name: string;
  runtime_id: string;
  status: 'running' | 'stopped';
}

async function fetchInstances(runtimeId: string): Promise<Instance[]> {
  // The hook decides the transport based on runtime metadata.
  // In practice, the command layer handles this; the hook just passes runtimeId.
  return invoke<Instance[]>('list_instances', { runtimeId });
}

export function useInstances(runtimeId: string) {
  return useQuery({
    queryKey: ['instances', runtimeId],
    queryFn: () => fetchInstances(runtimeId),
  });
}
```

```typescript
// hooks/useChat.ts
import { invoke } from '@tauri-apps/api/core';
import { useMutation } from '@tanstack/react-query';

interface ChatPayload {
  instanceId: string;
  runtimeId: string;
  message: string;
}

async function sendChat({ instanceId, runtimeId, message }: ChatPayload) {
  return invoke<string>('chat', {
    instanceId,
    runtimeId,
    message,
  });
}

export function useChat() {
  return useMutation({ mutationFn: sendChat });
}
```

The frontend does **not** branch on `type: 'local' | 'remote'` — it passes `runtimeId` to a unified command surface and lets the Rust layer resolve the transport.

### Tauri Command Design

The Rust backend introduces a unified command surface. Commands inspect the `AppState` to look up the runtime by `runtime_id` and dispatch to the appropriate transport implementation.

```rust
// src/commands/instance.rs
use tauri::{command, State};
use crate::state::AppState;
use crate::error::Error;
use crate::models::{Instance, RuntimeConnection};

#[command]
pub async fn list_instances(
    runtime_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Instance>, Error> {
    let runtime = state
        .get_runtime(&runtime_id)
        .await
        .ok_or(Error::RuntimeNotFound)?;

    match runtime.connection_type {
        RuntimeConnectionType::Local => {
            state.ipc_client.list_instances(&runtime.ipc_path).await
        }
        RuntimeConnectionType::Remote => {
            state.pekohub_client.list_instances(&runtime_id).await
        }
    }
}

#[command]
pub async fn chat(
    instance_id: String,
    runtime_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<String, Error> {
    let runtime = state
        .get_runtime(&runtime_id)
        .await
        .ok_or(Error::RuntimeNotFound)?;

    match runtime.connection_type {
        RuntimeConnectionType::Local => {
            state.ipc_client.chat(&instance_id, &message).await
        }
        RuntimeConnectionType::Remote => {
            state.pekohub_client.chat(&instance_id, &message).await
        }
    }
}
```

New Tauri commands for remote-specific operations:

```rust
// src/commands/remote.rs
use tauri::{command, State};
use crate::state::AppState;
use crate::error::Error;
use crate::models::Instance;

#[command]
pub async fn list_remote_instances(
    runtime_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Instance>, Error> {
    state.pekohub_client.list_instances(&runtime_id).await
}

#[command]
pub async fn remote_chat(
    instance_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<StreamHandle, Error> {
    state.pekohub_client.chat(&instance_id, &message).await
}
```

> **Note:** The `StreamHandle` type for SSE streaming will be implemented using Tauri's event system (`tauri::Emitter`) to push chunks to the frontend, keeping the command async and non-blocking.

### State & Transport Layer

```rust
// src/state.rs
use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct AppState {
    pub runtimes: RwLock<HashMap<String, RuntimeConnection>>,
    pub ipc_client: IpcClient,
    pub pekohub_client: PekohubClient,
    pub secure_store: SecureStore,
}

impl AppState {
    pub async fn get_runtime(&self, id: &str) -> Option<RuntimeConnection> {
        self.runtimes.read().await.get(id).cloned()
    }
}
```

### Pekohub Client (HTTP)

```rust
// src/clients/pekohub.rs
use reqwest::{Client, header::AUTHORIZATION};
use crate::error::Error;

pub struct PekohubClient {
    http: Client,
    base_url: String,
    token_store: SecureStore,
}

impl PekohubClient {
    pub async fn list_instances(&self, runtime_id: &str) -> Result<Vec<Instance>, Error> {
        let token = self.token_store.get_access_token().await?;
        let url = format!("{}/v1/instances?runtime_id={}", self.base_url, runtime_id);

        let resp = self
            .http
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send()
            .await?;

        resp.json().await.map_err(Into::into)
    }

    pub async fn chat(&self, instance_id: &str, message: &str) -> Result<String, Error> {
        let token = self.token_store.get_access_token().await?;
        let url = format!("{}/v1/instances/{}/chat", self.base_url, instance_id);

        let resp = self
            .http
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .json(&serde_json::json!({ "message": message }))
            .send()
            .await?;

        resp.text().await.map_err(Into::into)
    }
}
```

## UI/UX Changes

1. **Sidebar Agent List**
   - All agents from all connected runtimes appear in a single list.
   - Each item shows the agent name, status, and a 💻/🌐 indicator.
   - Offline runtimes are collapsed or greyed out with an "Offline" badge.

2. **Agent Creation Modal**
   - A **Runtime Selector** dropdown is added.
   - The default selection is the local runtime (if connected) or the last-used runtime.

3. **Settings → Runtimes Page**
   - List of configured runtimes with connection status.
   - "Add Remote Runtime" button triggers pekohub OAuth/sign-in flow.
   - "Remove" and "Reconnect" actions per runtime.
   - Edit display name inline.

4. **Chat View**
   - If the agent's runtime is disconnected, the input field is disabled with a tooltip: "Runtime offline — reconnect to continue."
   - No visible transport details in the chat header (only agent name and runtime indicator).

## Migration Path

1. **Phase 1 — Backend Foundation**
   - Introduce `RuntimeConnection` model and `AppState` refactor.
   - Add `PekohubClient` with JWT retrieval from secure storage.
   - Implement `list_instances` and `chat` as unified commands.

2. **Phase 2 — UI Integration**
   - Update React hooks to accept `runtimeId`.
   - Add runtime indicator to sidebar agent cards.
   - Build Settings → Runtimes page.

3. **Phase 3 — Remote Features**
   - Implement pekohub sign-in flow (OAuth2 PKCE).
   - Enable fetching remote runtime lists and instances.
   - Add SSE streaming support for remote chat.

4. **Phase 4 — Polish**
   - Offline badges, caching layer, retry logic.
   - Runtime selector in agent creation modal.

## Reasoning

- **Unified command surface** reduces frontend complexity. The React layer stays agnostic to transport; branching happens once in Rust.
- **pekohub as the proxy** leverages existing tunnel infrastructure (ADR-035) and avoids exposing runtimes directly to the internet.
- **Secure token storage** via Tauri `stronghold`/keyring follows platform best practices and keeps credentials out of plaintext.
- **No message queuing** keeps the implementation simple. Users get immediate feedback on connectivity issues. Queueing can be added later if user research shows it is needed.
- **Single sidebar** matches user mental models — they think about agents, not runtimes.

## Tradeoffs Accepted

| Tradeoff | Rationale |
|----------|-----------|
| Remote chat latency is higher than local IPC | Inevitable due to network round-trips. The tunnel protocol (ADR-035) mitigates this with persistent connections. |
| Remote runtime requires pekohub account | Centralized identity and tunneling simplify security and NAT traversal. |
| No offline message queue | Simpler initial implementation. Users must be online to interact with remote runtimes. |
| Local caching limited to lightweight data | Full message history sync is deferred to future work (see Out of Scope). |
| JWT in secure storage adds platform dependency | Tauri v2's `stronghold` and OS keyrings are well-supported across macOS, Windows, and Linux. |

## Alternatives Considered

1. **Direct TCP/UDP connection to remote runtime**
   - Rejected: requires exposing runtimes publicly or managing VPNs, defeating the purpose of the tunnel architecture.

2. **Separate "Remote Mode" UI (e.g., a switch or separate window)**
   - Rejected: fragments the user experience. Users want to see all agents in one place.

3. **GraphQL or gRPC instead of REST for pekohub API**
   - Rejected: REST + SSE is already used in pekohub. Adding a second protocol increases complexity without clear benefit for this use case.

4. **Message queue with local SQLite for offline send-later**
   - Rejected for initial scope: adds significant complexity. May be revisited if offline usage becomes a priority.

## Consequences

### Positive

- Users can manage agents across multiple machines from a single desktop app.
- The architecture is extensible: adding new connection types (e.g., LAN discovery) only requires a new variant in `RuntimeConnectionType`.
- The frontend remains simple and transport-agnostic.
- Security is centralized through pekohub's existing auth and tunnel infrastructure.

### Negative

- Additional complexity in the Rust backend (two transport implementations to maintain).
- Remote runtime features depend on pekohub availability and the user's internet connection.
- JWT management adds failure modes (expired tokens, refresh failures) that must be handled gracefully.

## Out of Scope (Future Work)

- **Bi-directional sync of full message history** between desktop and remote runtime.
- **Offline message queue / send-later** for remote runtimes.
- **LAN auto-discovery** of remote runtimes on the same network without pekohub.
- **Runtime-specific settings sync** (extensions, environment variables) across devices.
- **Multi-user / shared runtime access** within a team or organization.

## Success Criteria

- [ ] User can sign into pekohub from the desktop app.
- [ ] User can see agents from both local and remote runtimes in a single sidebar.
- [ ] User can chat with a remote agent with latency comparable to the web UI (within 1.5×).
- [ ] User can create a new agent on a remote runtime via the desktop UI.
- [ ] Remote runtime disconnects gracefully: offline badge appears, chat input disabled, no crashes.
- [ ] Local runtime behavior is unchanged when no remote runtimes are configured.
- [ ] JWT is never stored in plaintext (verified by code review).

## References

- ADR-001-desktop — Desktop IPC vs CLI Shell-Out
- ADR-035 — Tunnel Protocol
- ADR-032 — Runtime Identity
- ADR-036 — Remote Instance Management
- ADR-037 — Exposure Modes
- [Tauri v2 Security Best Practices](https://tauri.app/security/)
- [Tauri Stronghold Plugin](https://tauri.app/plugin/stronghold/)
