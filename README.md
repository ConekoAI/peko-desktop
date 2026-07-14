# Pekobot Desktop

> The Tauri 2 + React UI for managing your local [peko](https://github.com/ConekoAI/peko-runtime) runtime.

Pekobot Desktop is the desktop client for the Pekobot ecosystem. It connects to a
running `peko-runtime` daemon (local or, soon, remote via PekoHub) and gives you
a graphical interface for browsing **Principals** (ADR-041), chatting
via `peko send`, reading activity via `peko log <PRINCIPAL>`
(ADR-042), managing cron jobs and extensions, and inspecting runtime
status.

---

## Prerequisites

| Tool         | Version        | Why                                                  |
| ------------ | -------------- | ---------------------------------------------------- |
| **Rust**     | 1.74+ stable   | Tauri 2 backend ([`src-tauri/`](src-tauri/)) and the bundled `peko` sidecar (built from [`peko-runtime`](https://github.com/ConekoAI/peko-runtime)) |
| **Node.js**  | 20+            | Vite + React frontend ([`src/`](src/))               |
| **pnpm**     | 9+ (or npm 10+)| Install JS dependencies                              |

> **End users don't need a separate `peko` install.** The desktop app
> bundles the `peko` runtime as a Tauri sidecar and spawns it
> automatically on startup (see [ADR-043](#architecture) and
> `scripts/fetch-peko-sidecar.sh`). The `peko daemon start | stop |
> status` CLI commands are still available for headless / server use,
> but the desktop GUI does not require them.
>
> **Local dev from source requires building `peko-runtime` first.**
> See "Quick start" below.

## Quick start

```bash
# 1. Install JS dependencies
pnpm install

# 2. Build peko-runtime and copy the sidecar binary in
pnpm run sidecar:build-and-fetch
# (or, if you've already built peko-runtime separately:)
#   pnpm run sidecar:fetch /path/to/peko-runtime

# 3. Launch the desktop app in dev mode (Vite + Tauri)
pnpm tauri dev
```

The first `pnpm tauri dev` will compile the Rust side, which can take a few
minutes on a cold cache. Subsequent runs are incremental.

## Building a release binary

```bash
pnpm run sidecar:build-and-fetch   # builds peko-runtime + copies sidecar
pnpm tauri build
```

Outputs land in `src-tauri/target/release/bundle/` (`.dmg` / `.msi` /
`.AppImage` / `.deb`, depending on the host OS). The Rust binary itself is at
`src-tauri/target/release/peko-desktop` (or `peko-desktop.exe` on Windows).
The `peko` runtime binary is bundled inside the app — end users do not
need to install anything else.

## Testing

```bash
pnpm test           # run Vitest suite once (CI mode)
pnpm test:watch     # watch mode
```

## Project layout

```
peko-desktop/
├── src/                    # React + TanStack Router frontend
│   ├── routes/             # File-based routes (TanStack Router)
│   ├── components/         # Shared UI components
│   ├── hooks/              # React hooks (IPC, auth, etc.)
│   ├── lib/                # Frontend helpers
│   └── pages/              # Page-level components
├── src-tauri/              # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── ipc/            # Daemon IPC client (UDP / Unix socket)
│   │   ├── commands/       # Tauri command handlers (one per CLI subcommand)
│   │   ├── daemon/         # Daemon lifecycle & auto-restart
│   │   ├── vault/          # OS keyring integration for tokens
│   │   └── tray/           # System tray icon
│   ├── capabilities/       # Tauri permission allowlist
│   └── tauri.conf.json     # Tauri config (CSP, window, bundle)
├── docs/
│   └── architecture/adr/   # Architecture Decision Records
└── public/                 # Static assets
```

## Architecture

The desktop app is intentionally thin: all real work happens in
[`peko-runtime`](https://github.com/ConekoAI/peko-runtime). It speaks to the
runtime over two transports — see the ADRs for the rationale.

- **[ADR-002 — Desktop Remote Runtime Support](docs/architecture/adr/ADR-002-desktop-remote-runtime-support.md)** —
  multi-runtime model (local + remote) fronted by a `RuntimeConnection`
  abstraction, with PekoHub as the broker for remote principals.
- **[ADR-043 — Sidecar Lifecycle: Desktop Owns the Engine](../../../peko-runtime/docs/architecture/adr/ADR-043-sidecar-lifecycle.md)**
  *(runtime-side)* — the desktop bundles `peko` as a Tauri sidecar, owns the
  engine lifecycle, and exposes no Start/Stop buttons. The runtime is invisible
  to end users.
- **[ADR-001 — Desktop GUI Communication (CLI shell-out vs direct IPC)](docs/architecture/adr/ADR-001-desktop-ipc-vs-cli-shellout.md)** —
  *Superseded 2026-07-05 by ADR-041/042.* Kept for historical context.
- **[Post-migration checklist](docs/phase3/Pre_Migration_Checklist.md)** —
  current source of truth for the desktop's v0 launch surface.

For the Principal-as-container model and the `peko log` privacy
contract, see the runtime-side
[ADR-041](../../../peko-runtime/docs/architecture/adr/ADR-041-principal-as-container.md)
and
[ADR-042](../../../peko-runtime/docs/architecture/adr/ADR-042-no-external-session-concept.md).

## Security

The desktop app is built on Tauri's permission model, which means the frontend
**cannot** touch the host OS, filesystem, or network directly — every privileged
operation has to go through a Rust `#[tauri::command]` exposed via a capability
file. The current allowlist
([`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json))
is intentionally narrow:

- `core:default` + a small set of window controls (minimize / maximize /
  unmaximize / close / drag / is-maximized)
- `opener:default` — open external URLs in the user's default browser
- **No** filesystem, shell, HTTP, or dialog permissions

A strict [Content-Security-Policy](src-tauri/tauri.conf.json) is enforced at
the WebView layer (`default-src 'self'`, no remote scripts, IPC traffic only
over `ipc:` / `http://ipc.localhost`), and `react-markdown` output is
sanitized through `rehype-sanitize` before rendering.

For remote runtimes, authentication uses OAuth2 PKCE against
[PekoHub](https://github.com/ConekoAI/pekohub) and tokens are stored in the OS
keyring ([`src-tauri/src/vault/`](src-tauri/src/vault/)). The runtime→PekoHub
handshake uses a tunnel allowlist + nonce challenge (see issue 001 in
`pekohub` and `peko-runtime`).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) +
  [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
  [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Related repositories

- [`ConekoAI/peko-runtime`](https://github.com/ConekoAI/peko-runtime) — the
  daemon this UI talks to
- [`ConekoAI/pekohub`](https://github.com/ConekoAI/pekohub) — the broker used
  for remote runtime support
- [`ConekoAI/.github`](https://github.com/ConekoAI/.github) — org-wide
  development standards and documentation
