/**
 * Browser-only stand-in for the Tauri backend, for working on the UI in a
 * plain browser (`npm run dev:mock`). Loaded only when `VITE_MOCK_IPC=1`;
 * the desktop build never includes it. Answers enough commands with
 * believable data to render every screen; anything else resolves to null.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();

/** A picture shaped like a pairing code (not a real one). */
function mockCode(): string {
  const n = 33;
  let cells = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const corner = (x < 7 || x >= n - 7) && y < 7 ? true : x < 7 && y >= n - 7;
      const on = corner
        ? x % (n - 7) === 0 || x % (n - 7) === 6 || y % (n - 7) === 0 || y % (n - 7) === 6 ||
          (x % (n - 7) > 1 && x % (n - 7) < 5 && y % (n - 7) > 1 && y % (n - 7) < 5)
        : (x * 7 + y * 13 + ((x * y) % 5)) % 3 === 0;
      if (on) cells += `<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells}</g></svg>`;
}
/** A peko's sharing (runtime ADR-113), changed by `principal_set_access`. */
let mockAccess = {
  visitors: {
    tools: ["Read", "Glob", "Grep", "Fetch", "Attach", "Suggest"],
    mcp: [] as string[],
    read: ["public/", "kb/CONVENTIONS.md"],
    write: [] as string[],
    ask_owner: false,
  },
  people: [] as { address: string; display_name?: string | null; rule: { tools: string[]; mcp: string[]; read: string[]; write: string[]; ask_owner: boolean } }[],
  known: [
    { address: "visitor:local:+15550100", display_name: "Ada" },
    { address: "user:hub:22222222-2222-2222-2222-222222222222", display_name: "Ben" },
  ],
  servers: ["orders", "calendar"],
  workspace: "/Users/you/.peko/pekos/aria",
  problem: null as string | null,
};
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

const pekos = [
  {
    name: "aria",
    localId: "prin_aria",
    avatar: "🦊",
    hubId: "11111111-1111-1111-1111-111111111111",
    exposure: "public",
    status: "online",
    description: "Research partner — reads papers, keeps notes, and follows up.",
    preferredModelId: "claude-sonnet",
    owner: "user:local",
    runtimeId: "local",
    bootState: "organized",
  },
  {
    name: "bolt",
    localId: "prin_bolt",
    avatar: "⚡",
    hubId: null,
    exposure: "private",
    status: "online",
    description: "Runs errands on this computer: files, builds, reminders.",
    preferredModelId: "gpt-local",
    owner: "user:local",
    runtimeId: "local",
    bootState: "organized",
  },
  {
    name: "sage",
    localId: "prin_sage",
    avatar: null,
    hubId: null,
    exposure: "private",
    status: "offline",
    description: "Writing coach.",
    owner: "user:local",
    runtimeId: "local",
    bootState: "organized",
  },
];

const remotePekos = [
  {
    hubUrl: "https://api.pekohub.ai",
    owner: "mika",
    principalName: "nova",
    displayName: "nova",
    description: "Mika's travel planner.",
    exposure: "public",
    status: "online",
    runtimeId: "hub:https://api.pekohub.ai",
    addedAtUnixMs: now - 86_400_000,
    hasInviteToken: false,
    hubId: "22222222-2222-2222-2222-222222222222",
    avatar: "🌙",
    localId: "prin_nova",
    fromAccount: false,
    runtimeName: "mika-laptop",
  },
];

function messages(peko: string) {
  const p = `principal:local:prin_${peko}`;
  const u = "user:local";
  const m = (i: number, sender: string, text: string, mins: number, extra = {}) => ({
    schemaVersion: 1,
    id: `chat_${peko}_${i}`,
    sender,
    timestamp: ago(mins),
    text,
    ...extra,
  });
  return [
    m(1, u, "Morning! Can you pull together what we know about the battery recycling papers from last week?", 180),
    m(
      2,
      p,
      "Sure. Here's where things stand:\n\n1. **Hydrometallurgy** is still the most-cited route — three of the five papers use it.\n2. Two papers compare *direct recycling* costs; both land around **$4–6/kWh**.\n3. Open question: none of them report lithium recovery above 92%.\n\n```python\nrecovery = {\"hydro\": 0.92, \"pyro\": 0.71, \"direct\": 0.88}\n```\n\nWant me to draft a one-page summary?",
      178,
    ),
    m(3, u, "Yes please, and put it in my notes folder.", 60),
    m(
      4,
      p,
      "Done — saved `notes/battery-recycling.md`. I also set a check-in for Friday to look for new preprints.",
      58,
      { options: ["Show me the summary", "Add two more sources"] },
    ),
  ];
}

const channels = [
  { channelId: "chan_launch", name: "launch-plan", kind: "group" },
  { channelId: "chan_reading", name: "reading-club", kind: "group" },
];

function channelEvents(channelId: string) {
  const ch = channels.find((c) => c.channelId === channelId) ?? channels[0];
  return [
    { kind: "created", channel: ch.channelId, creator: "user:local", name: ch.name, at: ago(600) },
    { kind: "member_joined", channel: ch.channelId, member: "principal:local:prin_aria", at: ago(599) },
    { kind: "member_joined", channel: ch.channelId, member: "principal:local:prin_bolt", at: ago(598) },
    {
      kind: "posted",
      channel: ch.channelId,
      author: "user:local",
      parent: null,
      text: "Let's get the launch checklist sorted this week. @aria can you own the announcement draft?",
      at: ago(120),
      msg_id: "m1",
    },
    {
      kind: "posted",
      channel: ch.channelId,
      author: "principal:local:prin_aria",
      parent: null,
      text: "On it. I'll put a first draft up by tomorrow and add it to the board.",
      at: ago(118),
      msg_id: "m2",
      board: { op: "add", title: "Draft launch announcement", for: "principal:local:prin_aria" },
    },
    {
      kind: "posted",
      channel: ch.channelId,
      author: "principal:local:prin_bolt",
      parent: null,
      text: "I can handle the release build and the changelog.",
      at: ago(30),
      msg_id: "m3",
    },
  ];
}

const board = [
  {
    id: "m2",
    short: "b3f9a1",
    title: "Draft launch announcement",
    added_by: "principal:local:prin_aria",
    for: "principal:local:prin_aria",
    state: "doing",
    claimant: "principal:local:prin_aria",
    note: "First draft by tomorrow",
    added_at: ago(118),
    updated_at: ago(100),
  },
  {
    id: "m3",
    short: "c41d07",
    title: "Release build + changelog",
    added_by: "principal:local:prin_bolt",
    state: "open",
    added_at: ago(30),
    updated_at: ago(30),
  },
  {
    id: "m4",
    short: "9e2a55",
    title: "Pick a launch date",
    added_by: "user:local",
    state: "blocked",
    claimant: "user:local",
    note: "Waiting on the venue",
    added_at: ago(300),
    updated_at: ago(200),
  },
];

const models = [
  {
    id: "claude-sonnet",
    displayName: "Claude Sonnet",
    templateId: "anthropic",
    apiFormat: "anthropic",
    baseUrl: "https://api.anthropic.com",
    modelId: "claude-sonnet-5-5",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    headers: {},
    credentialId: "cred_1",
    requiresKey: true,
    isLocal: false,
    enabled: true,
    spec: null,
  },
  {
    id: "gpt-local",
    displayName: "Llama (local)",
    templateId: "ollama",
    apiFormat: "openai",
    baseUrl: "http://localhost:11434/v1",
    modelId: "llama3.3",
    contextWindow: 128000,
    headers: {},
    requiresKey: false,
    isLocal: true,
    enabled: true,
    spec: null,
  },
];

const settings = [
  { key: "hub_url", value: "https://api.pekohub.ai", category: "hub" },
  { key: "keep_awake", value: "false", category: "general" },
];

let privacy = { acknowledged: true, crashReports: true, usageEvents: true };
let planPolls = 0;

function handle(cmd: string, args: Record<string, unknown> = {}): unknown {
  switch (cmd) {
    case "engine_status":
      return { kind: "running", pid: 4242, version: "0.1.0", uptime_secs: 3600 };
    case "engine_diagnostics":
      return {
        state: { kind: "running", pid: 4242, version: "0.1.0", uptime_secs: 3600 },
        pid: 4242,
        version: "0.1.0",
        expected_version: "0.1.0",
        version_matches: true,
        uptime_secs: 3600,
        lockfile_path: "~/.peko/run/daemon.lock",
        socket_path: "~/.peko/run/daemon.sock",
        log_ring: [],
        restart_count: 0,
        last_error: null,
        owns_process: true,
        mode: "sidecar",
      };
    case "daemon_status":
      return { running: true, pid: 4242, uptime: 3600, version: "0.1.0" };
    case "system_status":
      return {
        daemon: { running: true, pid: 4242, uptime: 3600, version: "0.1.0" },
        platform: "macos",
        arch: "aarch64",
        memory: { total: 32e9, used: 12e9, free: 20e9 },
        cpu: { cores: 10, usage: 12 },
        disk: { total: 1e12, used: 4e11, free: 6e11 },
      };
    case "principal_list":
      return pekos;
    case "principal_get":
      return pekos.find((p) => p.name === args.name) ?? null;
    case "remote_principal_list":
      return remotePekos;
    case "seed_contents":
      return String(args.seed ?? "").includes("setup")
        ? {
            steps: ["Make sure Node is installed", "Install ripgrep"],
            files: [
              {
                path: "mcp/playwright/server.json",
                size: 58,
                content: '{ "command": "npx", "args": ["@playwright/mcp@latest"] }',
              },
              { path: "roles/researcher.md", size: 127, content: null },
              { path: "skills/release-notes/SKILL.md", size: 840, content: null },
            ],
          }
        : { steps: [], files: [] };
    case "principal_setup_status":
      // bolt is going through its setup steps; aria has finished with one
      // step failed.
      if (args.name === "bolt") {
        return {
          settingUp: false,
          running: true,
          setup: ["Install ripgrep", "Add the Playwright MCP server"],
          steps: [
            { callId: "c2", tool: "Fetch", line: "Fetch: https://github.com/microsoft/playwright-mcp", outcome: "ok" },
            { callId: "c3", tool: "Bash", line: "Bash: sudo apt install ripgrep", outcome: "error" },
            { callId: "c4", tool: "Bash", line: "Bash: cargo install ripgrep --root ~/.local", outcome: null },
          ],
          report: null,
          setupState: "running",
          results: [
            { step: "Install ripgrep", status: "pending", note: null },
            { step: "Add the Playwright MCP server", status: "pending", note: null },
          ],
        };
      }
      if (args.name === "aria") {
        return {
          settingUp: false,
          running: false,
          setup: ["Install ripgrep", "Add the Playwright MCP server"],
          steps: [],
          report: null,
          setupState: "done",
          results: [
            { step: "Install ripgrep", status: "ready", note: "`rg --version` prints 14.1.0" },
            {
              step: "Add the Playwright MCP server",
              status: "failed",
              note: "Node is not installed; run `brew install node`, then try again.",
            },
          ],
        };
      }
      return { settingUp: false, running: false, setup: [], steps: [], report: null, setupState: "none", results: [] };
    case "principal_setup_run":
      return null;
    case "principal_stop_setup":
      return true;
    case "principal_log":
      return {
        principal: args.name,
        peer: "user:local",
        messages: messages(String(args.name ?? "aria")),
        next_cursor: null,
        has_more: false,
      };
    case "principal_log_watch_start":
      return 1;
    case "principal_usage":
      return {
        state: { tokens_used: 182_000, requests_used: 64, cost_usd: 1.42, cycle_start: ago(60 * 24 * 3) },
        config: { tokens_per_cycle: 1_000_000, requests_per_cycle: 500, budget_per_cycle: 10 },
      };
    case "principal_access":
      return mockAccess;
    case "principal_set_access": {
      const a = args as { visitors: typeof mockAccess.visitors; people: typeof mockAccess.people };
      mockAccess = { ...mockAccess, visitors: a.visitors, people: a.people.map((p) => ({ ...p, display_name: mockAccess.known.find((k) => k.address === p.address)?.display_name ?? null })) };
      return mockAccess;
    }
    case "principal_secret_requests":
      return [];
    case "principal_answer_secret":
      return args.decline ? "Declined." : "Saved.";
    case "principal_approvals":
    case "principal_permissions":
      return cmd === "principal_permissions" ? { permissions: [] } : [];
    case "channel_list":
      return channels.map((c) => ({ channelId: c.channelId, runtimeId: "local" }));
    case "channel_get": {
      const c = channels.find((x) => x.channelId === args.channelId);
      return c
        ? { channelId: c.channelId, name: c.name, creator: "user:local", createdAt: ago(600), memberCount: 3, runtimeId: "local" }
        : null;
    }
    case "channel_info": {
      const c = channels.find((x) => x.channelId === args.channelId) ?? channels[0];
      return {
        channelId: c.channelId,
        kind: "group",
        name: c.name,
        members: ["user:local", "principal:local:prin_aria", "principal:local:prin_bolt"],
        pekos: [
          { name: "aria", localId: "prin_aria", wake: "mention" },
          { name: "bolt", localId: "prin_bolt", wake: "human" },
        ],
        group: { homeHere: true, owner: "user:local", hubId: null, page: null, visibility: null },
        people: [
          { address: "user:local", aliases: [], kind: "user", name: "You", you: true, here: true },
          { address: "principal:local:prin_aria", aliases: [], kind: "principal", name: "aria", you: false, here: true },
          { address: "principal:local:prin_bolt", aliases: [], kind: "principal", name: "bolt", you: false, here: true },
        ],
        createdAt: ago(600),
      };
    }
    case "channel_members":
      return {
        channelId: args.channelId,
        members: ["user:local", "principal:local:prin_aria", "principal:local:prin_bolt"],
        runtimeId: "local",
      };
    case "channel_events":
      return channelEvents(String(args.channelId));
    case "channel_board":
      return board;
    case "model_list":
      return models;
    case "runtime_list":
      return [{ id: "local", name: "This computer", connectionType: "local", status: "connected" }];
    case "privacy_get":
      return privacy;
    case "privacy_set":
      privacy = args.choices as typeof privacy;
      return privacy;
    case "report_ui_error":
    case "usage_event":
      return null;
    case "settings_list":
      return settings;
    case "settings_get":
      return settings.find((s) => s.key === args.key)?.value ?? null;
    case "peko_home_dir":
      return "/Users/you/.peko";
    case "credential_list_generic":
      return [
        { id: "cred_1", namespace: "anthropic", name: "Anthropic key", kind: "api_key", hasKey: true, lastTestedOk: true },
      ];
    case "hub_account":
    case "paired_phones":
    case "paired_phone_remove":
      return [
        { deviceId: "dev_mock1", name: "Mira's iPhone", platform: "ios", pairedAt: ago(60 * 26), lastSeen: ago(4) },
      ];
    case "phone_pair_start":
      return { svg: mockCode(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    case "local_user_account":
      return null;
    case "hub_get":
      if (args.resource !== "seeds") return null;
      return {
        status: 200,
        body: JSON.stringify({
          items: [
            { owner: "peko", name: "briefing", displayName: "Briefing", avatar: "📰", description: "Follows the pages you name and sends you what changed, once a day." },
            { owner: "peko", name: "notebook", displayName: "Notebook", avatar: "📒", description: "Remembers what you tell it, finds it again, and reminds you on the day." },
            { owner: "peko", name: "coach", displayName: "Coach", avatar: "🎯", description: "Turns a goal into small steps and checks in with you until it is done." },
            { owner: "peko", name: "scribe", displayName: "Scribe", avatar: "🗂️", description: "Add it to a group: it keeps the board, tracks who does what, and sums up decisions." },
            { owner: "peko", name: "repo-watch", displayName: "Repo Watch", avatar: "🔭", description: "Reads the git repositories you point it at and reports what changed. Needs git." },
          ],
          total: 5,
        }),
      };
    case "hub_seed":
      return { status: 200, body: `name = "${String(args.name)}"\npersona = "A starter peko."\n` };
    // `?update=1` on the preview's address offers an update; `?update=package`
    // offers one this install can't apply itself.
    case "update_check": {
      const offer = new URLSearchParams(window.location.search).get("update");
      return { current: "0.1.5", available: offer ? "0.1.6" : null, canInstall: offer !== "package" };
    }
    case "update_install":
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("mock: no update to install")), 1500));
    case "hub_notifications":
      return { status: 200, body: JSON.stringify({ items: [], unread: 0 }) };
    case "person_dms":
    case "dm_requests":
    case "group_invitations":
    case "person_groups":
    case "blocked_people":
    case "read_state":
    case "remote_peko_undelivered":
      return [];
    // ChatGPT plan sign-in (runtime ADR-115): done on the second ask.
    case "chatgpt_sign_in_start":
      planPolls = 0;
      return { flowId: "mock-flow", url: "https://auth.openai.com/api/accounts/authorize?mock" };
    case "chatgpt_sign_in_status":
      planPolls += 1;
      return planPolls < 2
        ? { state: "waiting" }
        : {
            state: "done",
            credentialId: "mock-plan-credential",
            account: "you@example.com",
            models: [
              { slug: "gpt-6.2-sol", displayName: "GPT-6.2-Sol" },
              { slug: "gpt-6-luna", displayName: "GPT-6-Luna" },
            ],
          };
    case "chatgpt_sign_in_cancel":
      return null;
    default:
      return null;
  }
}

export function installMockIpc() {
  mockWindows("main");
  mockIPC(
    (cmd, payload) => {
      const result = handle(cmd, (payload ?? {}) as Record<string, unknown>);
      if (cmd.startsWith("plugin:") && result === null) return 0;
      return result;
    },
    { shouldMockEvents: true },
  );
}
