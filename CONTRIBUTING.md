# Contributing to Peko Desktop

Thanks for helping. Bug reports, fixes and translations are welcome. For
the engine and the `peko` command, see
[ConekoAI/Peko](https://github.com/ConekoAI/Peko).

Please report security problems privately:
[Peko's security policy](https://github.com/ConekoAI/Peko/blob/master/SECURITY.md)
covers this app too.

## Prerequisites

| Tool         | Version        | Why                                                  |
| ------------ | -------------- | ---------------------------------------------------- |
| **Rust**     | 1.74+ stable   | Tauri 2 backend ([`src-tauri/`](src-tauri/)) and the bundled `peko` sidecar (built from [`Peko`](https://github.com/ConekoAI/Peko)) |
| **Node.js**  | 20+            | Vite + React frontend ([`src/`](src/))               |
| **npm**      | 10+            | Install JS dependencies                              |

> **End users don't need a separate `peko` install.** The desktop app
> bundles the `peko` runtime as a Tauri sidecar and spawns it
> automatically on startup (`scripts/fetch-peko-sidecar.sh`). The `peko engine start | stop |
> status` CLI commands are still available for headless / server use,
> but the desktop GUI does not require them.
>
> **Local dev from source requires building Peko first.**
> See "Run it from source" below.

## Run it from source

```bash
# 0. Check out Peko beside this repo, under the folder name the scripts expect
git clone https://github.com/ConekoAI/Peko ../peko-runtime

# 1. Install JS dependencies
npm ci

# 2. Build the engine from ../peko-runtime and copy it in
npm run sidecar:build-and-fetch
# (or, if you've already built it elsewhere:)
#   npm run sidecar:fetch /path/to/peko-runtime

# 3. Launch the desktop app in dev mode (Vite + Tauri)
npm run tauri dev
```

The first `npm run tauri dev` will compile the Rust side, which can take a few
minutes on a cold cache. Subsequent runs are incremental.

## Testing

```bash
npm test            # run Vitest suite once (CI mode)
npm run test:watch     # watch mode
```

## Building a release binary

```bash
npm run sidecar:build-and-fetch   # builds the engine + copies it in
npm run tauri build -- --config src-tauri/tauri.no-updates.conf.json
```

The `--config` leaves out the signed files in-app updates use. Without it
the build asks for the update signing key (`TAURI_SIGNING_PRIVATE_KEY`) and
fails when it isn't set. The release workflow signs with the key from the
repository's secrets; see the notes at the top of
`.github/workflows/release.yml`.

Outputs land in `src-tauri/target/release/bundle/` (`.dmg` / `.msi` /
`.AppImage` / `.deb`, depending on the host OS). The Rust binary itself is at
`src-tauri/target/release/peko-desktop` (or `peko-desktop.exe` on Windows).
The `peko` runtime binary is bundled inside the app — end users do not
need to install anything else.

## Versions

The app and the Peko engine are released separately.
[`src-tauri/runtime-version`](src-tauri/runtime-version) holds one runtime
version: the one a release bundles, and the oldest one the app accepts
from an engine it didn't start. A later runtime in the same minor line
(`0.1.x`) is fine; an older one, or one from a later line, shows a
warning. Move the file forward when the app needs a newer runtime. The
release workflow builds the bundled engine from that runtime release, so
it has to exist first.

## Project layout

```
peko-desktop/
├── src/                    # React + TanStack Router frontend
│   ├── routes/             # File-based routes (TanStack Router)
│   ├── components/         # Shared UI components
│   ├── hooks/              # React hooks (IPC, auth, etc.)
│   ├── lib/                # Frontend helpers
│   ├── i18n/               # The app's text, one folder per language
│   └── pages/              # Page-level components
├── src-tauri/              # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── ipc/            # Engine IPC client (Unix socket / named pipe / UDP)
│   │   ├── commands/       # Tauri command handlers
│   │   ├── sidecar/        # Starts, watches and restarts the bundled engine
│   │   ├── clients/        # PekoHub sign-in and API calls
│   │   ├── updater/        # In-app updates
│   │   └── tray/           # System tray icon: opens the app and quits it
│   ├── capabilities/       # Tauri permission allowlist
│   └── tauri.conf.json     # Tauri config (CSP, window, bundle)
├── docs/media/             # Images for the README
└── public/                 # Static assets
```

## Text and languages

Every string a person reads lives in `src/i18n/locales/en/`, one JSON file
per area of the app (`chat.json`, `settings.json`, …). Components read it
with `useTranslation()` from `react-i18next`; other modules import `t` from
`src/i18n`. Keys are type-checked against the English files, and a test
(`I18nNoHardcodedText.test.ts`) fails on text written straight into the
markup.

```tsx
const { t } = useTranslation();
<button title={t("common.close")}>{t("chat.working", { name })}</button>
```

A sentence with markup inside it uses `<Trans>`, so a translation can
reorder the pieces. Counts pass `count`, which lets a language add its own
plural forms (`key_one`, `key_other`).

The app ships in English, Simplified and Traditional Chinese, Japanese,
Korean, Spanish, French, German, Brazilian Portuguese, Russian and Italian
(`src/i18n/languages.ts`). It follows the system's language, and Settings →
General → Language picks another. English is bundled; any other language is
loaded when it is first shown.

To add a language, copy `locales/en/*.json` to `locales/<code>/`, translate
the values, and add it to `LANGUAGES`. `I18nLanguages.test.ts` then holds it
to English: the same keys, the same `{{values}}` and `<tags>` in each
string, and every plural form the language uses. A string added to English
must be added to every language, or that test fails.

The translations were machine-drafted and have not been reviewed by native
speakers. Right-to-left languages are not supported yet (the layout is not
mirrored). Text that comes from the runtime (its error messages, a peko's
replies) is not translated.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) +
  [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
  [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Pull requests

- One change per pull request, with a test where one fits.
- No text written straight into the markup: add it to `src/i18n/locales/en/`
  and to every other language (the tests say which keys are missing).
- The app shows people their pekos, not the machinery. Keep words like
  "runtime" and "daemon" out of the interface.

## License

By contributing you agree that your work is released under the
[MIT License](LICENSE).
