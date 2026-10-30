# peko-desktop gap map (2026-10-27)

Target: a desktop app at the level of **Grok** and **Meta Muse** in presentation, ease of use,
and features. Muse (Meta, 2026-09) is the closer match. It is a persistent personal agent with a
name, avatar, and style; it works on long-running tasks after you close the app and asks you to
approve actions. That is very close to what a peko is. Grok sets the bar for chat polish: modes,
attachments, voice, companions, and scheduled tasks.

## 1. Where the desktop stands

| | |
|---|---|
| Last commit | `5172fbd` 2026-09-17 (ADR-003 realignment). Runtime has since gained 114 commits and ADR-061 → ADR-086. |
| Build | `tsc` clean, `cargo check` clean, vitest 42 files / 345 tests pass. |
| Why green ≠ working | Every IPC packet is hand-built `serde_json::json!` in `src-tauri/src/ipc/mod.rs`; tests mock IPC, so wire drift is invisible. |
| Size | ~34k lines (TS + Rust); Tauri 2 + React 19 + TanStack Router/Query + Tailwind 4. |
| Screens | Dashboard, Chat, Log, Channels (+view), Discover, Settings, Cron, Extensions, Registry, Peko profile/capabilities. |

## 2. Broken today (wire drift against current runtime)

Checked against `peko-rs/core/src/ipc/packet.rs` (`RequestPacket` / `ResponsePacket`).

| Desktop call | Status | Effect |
|---|---|---|
| `principal_send_control` (interrupt / steer) | **Removed** in runtime | Stop and mid-run steering silently fail. Replacement: `principal_stop { name, peer }`; steer = another `principal_send` into the running thread (steering queue, ADR-048). |
| `principal_grant_permission` | Missing required `subject: ActorRef` | Every grant is rejected by serde. |
| `principal_revoke_permission` | Sends `grant_id`; runtime wants `subject` + `permission` | Every revoke is rejected. |
| `cron_list/add/remove/run` | Retired (PR #364) | Cron page dead. Cron lives only in the per-principal `Cron` tool now. |
| `extension_list/install/uninstall`, `capability_list/grant/revoke` | Retired (ADR-050/066) | Extensions page and Capabilities tab dead. |
| `principal_pull` (Registry) | Retired (ADR-066 P5) | Registry page dead. |
| `principal_set_exposure` | Retired; ADR-081 replaced exposure with local / registered-private / registered-public | Exposure toggle dead; registration (`principal_register`) not surfaced. |
| `principal_import` | Sends `confirmed/selected_capabilities/allow_unsigned`; runtime flow is `principal_import_preview` → `principal_import { expected_manifest_checksum, rotate_keys }` | Import works by accident of serde ignoring unknown fields, but skips the preview/checksum safety step. |
| `run_summary` response | Ignored ("unknown packet type") | Tool errors and token usage per run are thrown away. |

Not yet checked: response shapes (principal list/get, channel list/peek after ADR-082 `kind` +
`bindings`). These need a live smoke run, not static diffing.

## 3. Runtime features with no desktop surface

| Runtime capability | ADR | What users would see |
|---|---|---|
| Approvals: sensitive calls by non-owner runs wait for owner `approve <id>` / `deny <id>` | 078 | Today only a plain text message in the DM. Needs approve/deny cards, a badge, and an OS notification. **This is Muse's signature interaction.** |
| Tool ledger (hash-chained, per principal) | 079 | Activity timeline: "what did my peko do, and why" + verify. |
| Goals as plans, `checkAt` check-ins | 084 | Goals/tasks panel with progress and the next check-in. |
| Daily memory maintenance, memory claims vs sources, owner retraction | 080/085/#488 | "What it remembers" view with edit/retract. |
| Keepalive / quiet ticks / peer posts bring it forward | 083/086 | "Working…/idle/next wake" presence, background activity feed. |
| Contacts (local + Hub ids, registration state, mention tokens) | 074/081 | Contacts list, add from Hub, @mention autocomplete. |
| DM vs group, per-binding wake policy (`human`/`mention`/`off`) | 082 | Group settings: wake policy per peko; DM/group distinction in the sidebar. |
| Ownership transfer, single online copy | 081 | Transfer and "running elsewhere" states. |
| Quota and cost ceiling (`quota_get/set/reset`) | F19/F39 | Usage and spend meter, budget setting. |
| Audit (`audit_query`), runtime info, tunnel status, API keys | 046/… | Settings → Security/Advanced. |
| `principal_log_watch` (live thread stream) | — | Replaces polling for cron, peer, and approval messages that arrive while the chat is open. |
| `override_model` on send | — | Per-message model picker (Grok-style). |
| Avatar (`principal.toml` `avatar`) | — | Peko identity with face, name, and style everywhere. |
| Roles (`roles/<name>.md`), skills, workflows as workspace files | 050/061/064 | "Abilities" view: list, open in editor, drop in new files. |

## 4. UX gap against Grok / Muse

The current Chat reads like an admin console: "You / Assistant" labels, generic bot icon, a
single-line `<input>`, `break-all` wrapping, no Stop button, and a spinner as the only progress
signal.

| Area | Grok / Muse bar | Desktop now | Gap |
|---|---|---|---|
| Identity | Named persona with avatar and style (Muse); companions (Grok) | Bot icon, "Assistant" | Show the peko's avatar, name, and accent colour; persona chosen at creation. |
| Home | One-tap conversation, suggestions | Dashboard tables | Home screen = the peko + "what it's doing / needs from you" + prompt suggestions. |
| Composer | Multi-line, attachments, paste image, voice, mode toggles, model picker, ⌘↵ | Single-line input | Auto-growing textarea, drag/drop and paste, slash commands, @mentions, model picker. |
| Streaming | Smooth token stream, visible thinking and tool steps, Stop | Text chunks only; Stop broken | Tool/thinking steps as collapsible rows; working Stop; steer while running. |
| Message actions | Copy, retry/regenerate, edit, share, feedback | None | Copy, code-block copy, retry, quote-reply. |
| Rendering | Code highlighting, tables, math, images, link cards | react-markdown + GFM only | Syntax highlighting, KaTeX, image rendering, wrapping fixes. |
| Long-running agent | Works after close; reports back; asks approval (Muse) | Not represented | Activity feed, approvals inbox, notifications, menu-bar presence. |
| Tasks / scheduling | Grok Tasks, Muse monitoring | Cron page (dead) | "Routines": read-only view of the peko's cron jobs and goals, created by asking the peko. |
| History / search | Conversation list + search | One thread per peer; Log page separate | Peko model = one continuous thread + memory. Add day separators, in-thread search (`principal_log` `query`), jump-to-date. Don't fake multi-thread. |
| Onboarding | Sign in → talking in < 30 s | 855-line walkthrough; model and credential setup first | Pick a model key → name and avatar → first message. Advanced options behind a disclosure. |
| Polish | Motion, empty states, consistent design system | Slate/emerald Tailwind, ad-hoc styles | Design tokens, a component kit, dark mode parity, skeletons, toasts. |
| Notifications / tray | Push for replies and approvals | Tray exists | OS notifications for replies, approvals, check-ins; unread badges. |
| Voice / images | Voice mode, image gen and understanding | None | Phase 3; needs runtime ingress for images (see §5). |

## 5. Runtime work the desktop depends on

The runtime has to change for several of these UX items. Some changes are small:

1. **Stream tool and thinking events over IPC.** `handlers/principal.rs` (~L2374–2433) already
   receives `ToolStart` / `ToolEnd` / thinking and drops them on purpose ("stay
   backend-only"). Add `principal_sent_tool { phase, name, summary }` and an optional
   `principal_sent_thinking`. Small change, big UX payoff.
2. **Image/file attachments on ingress.** `PrincipalSend*` carries `message: String` only.
   `ContentBlock::Image` already exists (F28). Add `attachments: Vec<…>` and persist them in
   the DM channel.
3. **Read APIs for plans, memory/kb, ledger, contacts.** These are mostly files today. The
   desktop runs on the same host, but it should go through IPC so ownership and trust rules
   (ADR-078) hold. Add `plan_list`, `memory_list/retract`, `ledger_query`, `contact_list`.
4. **Structured approval records.** Today an approval is free text in the DM. Add an
   `approval_list` read plus a structured marker on the DM post so the desktop can render a
   card without parsing prose.
5. **Shared wire types.** Generate the desktop's TS/Rust packet types from `peko-protocol`,
   or depend on it directly. That ends this class of drift. At minimum, add a runtime test
   that deserializes a fixture file of desktop request shapes.

Docs: AGENTS.md §1 still lists an "HTTP/WS daemon" and Axum. The daemon is IPC-only now.

## 6. Proposed phases

**Phase 0 — Realign (≈1 week).** Make what's there work, and delete what's dead.
- Replace `send_control` with `principal_stop` + steer-by-send; fix grant/revoke shapes; use
  the import preview → checksum flow; handle `run_summary`.
- Delete the Cron / Extensions / Registry / Capabilities pages and the exposure toggle
  (~1.5k lines). Add registration state (local / private / public).
- Switch chat refresh to `principal_log_watch`.
- Add a wire-contract test: desktop request fixtures deserialized by runtime `RequestPacket`
  in runtime CI.
- Live smoke run against a current `peko-daemon` sidecar (create → chat → stop → channel →
  export/import).

**Phase 1 — Chat that feels like Grok (≈2 weeks).** Runtime item 1 lands first.
*Status 2026-10-27:* runtime item 1 is done (peko-runtime#513: tool-step and thinking
packets, owner-only inputs/outputs, redacted). The chat shows a reply's steps as one
collapsible row. 2026-10-28: composer, per-message model, message actions,
and highlighting landed (#92); identity and design tokens follow — each peko
has an emoji/monogram avatar (`identity.avatar`, peko-runtime) and an accent
from its id, and the chat, channel, sidebar, and shell surfaces use semantic
tokens that switch with the theme. Onboarding is three steps (connect a model with its key → name and avatar →
first message, advanced options folded away). Groups show a DM/group badge
and a per-peko "replies to" picker (every message / @mentions / never).
**Phase 1 is complete;** Phase 2 (approvals, goals, activity, memory) needs
the runtime read APIs in §5 item 3–4 first.
- Peko identity (avatar, name, accent) in header, messages, and sidebar.
- New composer: textarea, ⌘↵, Stop/steer, model picker (`override_model`), @mention.
- Tool/thinking step rows, code highlighting + copy, message actions, day separators,
  in-thread search.
- Design-system pass: tokens, components, motion, empty states, dark parity.
- Onboarding cut to three steps.

**Phase 2 — Agent that feels like Muse (≈2–3 weeks).** Runtime items 3–4 land first.
- Home = peko + "needs you" (approvals) + "working on" (goals/check-ins) + recent activity.
- Approvals inbox with approve / approve-always / deny cards + OS notifications.
- Goals/Routines panel (plans + cron, read-only + "ask peko to change").
- Activity timeline from the ledger; memory view with retract.
- Groups: DM/group distinction, wake policy, contacts with Hub add.
- Menu-bar presence: status, unread, quick-ask.

**Phase 3 — Media and reach.** Image/file attachments (runtime item 2), voice in/out,
quota/spend meter, share/export a conversation, remote-runtime polish (ADR-002).

## 6a. Phase 0 status (2026-10-27)

Done on `feature/phase0-realign` (desktop) and `docs/agents-md-drift` (runtime). Not committed.

- **Stop and steer:** Stop calls `principal_stop`. Sending while the peko is busy queues the
  message (`[queued]`), and it shows as "Queued" until the reply lands. `run_summary` is
  handled and failed tool calls show under the reply.
- **Live thread:** `principal_log_watch` refreshes the chat. It starts from the newest row
  already loaded and re-subscribes every 3s. That covers a new peko, whose watch answers
  `[not_found]` until its first message.
- **Wire fixes:** grant/revoke now send `subject` + `permission`. Import is review →
  wake with the manifest checksum. Registration (`local_only` / `private` / `public`) goes
  through `principal_register`. Invite scopes match the runtime `Permission` enum.
  Channel members and invitees are read as `{kind, id}` actors.
- **Groups:** creating a group now has the creating peko invite `user:local`. Without that,
  the user could not read or post in their own group. DM channels (`dm_…`) are left out of
  the Channels list.
- **Deleted:** the Cron, Extensions, Registry, and Capabilities pages and their hooks, API,
  Rust commands, and IPC methods. Also the exposure toggle and BundleCard.
- **Contract:** runtime `ipc/fixtures/desktop_requests.json` plus a unit test that decodes
  every desktop request. On the desktop side, `scripts/check-ipc-contract.py`
  (`npm run check:ipc`) and an `ipc-contract` CI job.
- **Release:** `release.yml` and `sidecar:build-and-fetch` now build `-p peko-daemon`.
  The `peko` package is library-only and built no binary.
- **Live smoke:** 34/34 checks passed against an isolated `peko-daemon` built from source,
  with a local mock LLM, replaying the desktop's exact packets.

Closed since (see §6b): the group wake picker and DM/group badge (#95), member names
(#93), and the click-through of the running app (#102).

## 6b. Status after Phase 1 (2026-10-29)

Phase 1 is done, plus a UX audit and a click-through of the running app:

- **Audit (#98, #99, #101):** Settings is a gear in the rail with four sections (General,
  Models, Advanced, About); the Activity page (a duplicate of the chat) and the orphan
  Dashboard are gone; one "New peko" menu and one create form (onboarding's); Groups
  replace "Channels" in the UI; native macOS window buttons; removing and creating a peko
  land in the right chat.
- **Click-through (#102), found only by running the app:** opening a group showed the
  landing page (route had no outlet); the three group dialogs crashed the app on first
  open; you were never a group member and posted as a peko (which wakes no one); older
  messages were unreachable (`next_cursor` read as camelCase); running pekos showed
  offline; Settings could not scroll.
- **Small items (this PR):** Tauri npm and Rust packages aligned (`tauri build` works
  again); `@` lists a group's pekos in the composer; you leave a group as yourself
  (peko-runtime: `channel_leave` without a peko, `ChannelPort::leave_actor`), and groups you
  left drop out of the list.

## 6c. Decision: a peko's internals stay internal (2026-10-30)

Plans, memory, contacts, the ledger, and roles are the peko's own; the desktop shows no
screens for them. You talk to a peko and it manages itself:

- **Dropped:** §5 items 3–4 (read APIs for plans / memory / ledger / contacts, structured
  approval records) and Phase 2's Home dashboard, goals panel, activity timeline, and
  memory view.
- **Correcting what it knows** happens in chat ("what do you remember about me?",
  "forget that…"); the peko edits its own memory.
- **Approvals** stay in the DM: the peko asks, you answer `approve <id>` / `deny <id>`
  (ADR-078). Buttons on that message would be cosmetic, later.
- **Kept, and now the main signal:** proactive messages. With the internals hidden, a
  peko's DM is the only place its own initiative shows up, so the desktop shows an unread
  count per peko and an OS notification when a peko writes while you aren't looking.

Next after that: Phase 3, image and file attachments first (§5 item 2), then voice.



1. **One continuous thread per peko.** The chat with a peko is its DM channel, the same
   model the runtime uses. No "new chat" topics.
2. **All pekos are equal in the sidebar,** as in Grok bot. There is no primary peko.
3. **Groups are in the MVP.** Group channels, DM/group distinction, and per-peko wake
   policy are in scope, not deferred to after Phase 2.

## 6d. Attachments (2026-10-30)

Runtime item 2 is done (runtime ADR-088, peko-runtime#522); this branch is the desktop half.

- **Sending.** The paperclip opens a native picker (`tauri-plugin-dialog`), or you can drop
  files on the chat. Up to 8 files show as removable chips, and a message can be files alone.
  The engine reads them by path, so only pekos on this computer take attachments; the paperclip
  is hidden for hub-remote pekos.
- **Thread.** Images show as thumbnails. Audio, video, and other files show as chips with
  their size. Clicking either opens the engine's copy in its default app.
  `attachment_preview` / `attachment_open` only serve files under the peko folder.
- **Models.** Add and Edit model have "Understands: Text · Images · Audio · Video". A model
  given inputs this way keeps tools and thinking on (a spec saying "no tools" would make the
  engine refuse its tools). The gallery shows a Video badge.
- **Verified** with MiMo-V2.6-Flash, which reads images, audio, and video on the
  OpenAI-compatible endpoint.

Not done: pasting an image from the clipboard (it needs a temp file), and inline audio/video
players (chips open the system player).
