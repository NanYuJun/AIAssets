<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/logo-dark.png">
  <img src="docs/img/logo-light.png" alt="AIAssets" width="480">
</picture>

**A self-hosted home for your AI conversations** — sync them across machines, move them between agents.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-24%2B-green.svg)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/release/NanYuJun/AIAssets?include_prereleases)](https://github.com/NanYuJun/AIAssets/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](./docs/DEPLOYMENT.md)

English | [简体中文](./README.md)

</div>

---

Claude Code, Codex, Cursor and friends each keep their own history in their own
local format. Switch machines, switch tools, and the conversation is gone.

AIAssets collects those scattered sessions into one searchable library you own:
a small self-hosted hub plus a lightweight desktop client.

## Why

- **No common format.** Every agent stores sessions differently (JSONL, SQLite,
  zstd-compressed blobs, folder-slug naming). There is no shared standard.
- **No sync.** Sessions live in a dot-folder on one machine. A laptop and a
  desktop do not know about each other.
- **No portability.** Starting in Codex and continuing in Claude Code means
  copy-pasting by hand, with tool calls and file paths lost.

## Features

- **Cross-agent migration** — round-trip between 10 agents while keeping the
  AI-generated session title: Codex / WorkBuddy / Claude Code / Gemini CLI /
  DSH (DeepSeek) / Pi / ZCode / OpenCode / Grok Build / Cursor
- **Cross-device sync** — the hub is the meeting point; each machine runs a
  light client that pushes and pulls on a 60-second poll
- **Sharing** — time-limited links with an access code and a view cap; one
  click to import into someone else's hub
- **Collections** — group sessions by project, export a ZIP in one go
- **Backup** — local mirror plus timed archives to Cloudflare R2, Aliyun OSS,
  Tencent COS or S3, with retention you can set per target
- **Multi-user** — admin and member roles, per-user data isolation, guest mode
- **Full-text search** — millisecond search over every session body
- **Trash** — deletions are backed up first and restorable for 30 days

## Supported agents

| Agent | Read | Write | Local storage |
| :--- | :---: | :---: | :--- |
| Codex | Yes | Yes | `~/.codex/sessions/` |
| WorkBuddy | Yes | Yes | `~/.workbuddy/` + SQLite |
| Claude Code | Yes | Yes | `~/.claude/projects/` |
| Gemini CLI (Antigravity) | Yes | Yes | `~/.gemini/antigravity/` |
| DSH (DeepSeek) | Yes | Yes | `~/.dsh/sessions/` (zstd) |
| Pi | Yes | Yes | `~/.pi/agent/sessions/` |
| ZCode (Zhipu GLM) | Yes | Yes | `~/.zcode/cli/db/` |
| OpenCode | Yes | Yes | `~/.local/share/opencode/` |
| Grok Build (xAI) | Yes | Yes | `~/.grok/sessions/` |
| Cursor | Yes | Yes | `%APPDATA%/Cursor/` |

## How it works

```
MacBook (agents + light client) ──┐
                                 ├──→ Hub (storage, web UI, auth, sharing)
Desktop (agents + light client) ──┘
```

- **Hub** — Node.js server with zero npm dependencies. Web UI, session storage,
  auth, sharing, full-text search, backup jobs.
- **Light client** — Electron tray app (recommended) or a CLI script. Reads
  local agent sessions, pushes them to the hub, and writes sessions back into
  a chosen agent on request.

## Quick start

### Requirements

- Node.js **24+** (uses built-in `node:sqlite` and `zlib.zstdDecompressSync`)
- pnpm, only if you build the frontend or the desktop app

### 1. Start the hub

```bash
git clone https://github.com/NanYuJun/AIAssets.git aiassets
cd aiassets
npm start
# or: node src/server/index.js
# → http://0.0.0.0:4891
```

Open `http://localhost:4891` and create the admin account.

### 2. Or install from npm

```bash
npm install -g aiassets

aiassets daemon         # run in the background
aiassets status         # check it
aiassets stop           # stop it

# custom port and data directory
aiassets daemon --port 9000 --data /srv/aiassets-data

# light client against a remote hub
aiassets sync --hub http://hub:4891 --token <your-token>
```

### 3. Desktop client

Grab the installer from [Releases](https://github.com/NanYuJun/AIAssets/releases):

- Windows: `AIAssets Setup <version>.exe`
- macOS: `AIAssets-<version>-arm64.dmg` (Apple Silicon) or
  `AIAssets-<version>.dmg` (Intel)

Install it, point it at your hub, and sign in with your hub account. The app
issues a device token and starts syncing every 60 seconds from the tray.

The macOS builds are **not notarized**. On first launch, right-click the app
and choose Open, or run:

```bash
xattr -dr com.apple.quarantine /Applications/AIAssets.app
```

Windows builds are unsigned too: SmartScreen will ask you to click
"More info → Run anyway".

### 4. Or skip the app, use the CLI

```bash
node src/client/index.js config --hub http://hub:4891 --user admin
node src/client/index.js sync
node src/client/index.js daemon    # sync every 60 seconds
```

## Known limitations

Worth reading before you deploy it:

- **The hub is a plain Node process.** Put it behind HTTPS (Cloudflare Tunnel
  or Caddy) if it faces the internet. Auth is password-based with a 5-attempt
  lockout; there is no SSO.
- **Sync is poll-based.** Machines converge within about 60 seconds, not
  instantly. Conflicting edits resolve last-write-wins on the session record.
- **Search indexes titles and metadata**, not the full body of every message.
- **macOS and Linux packages are newer than the Windows build.** Windows is the
  primary target; macOS DMGs are produced by CI and by
  `pnpm run build:mac`, and are unsigned.
- **Writing a session into another agent is best-effort.** Project paths are
  remapped through a canonical form, but agents that refuse to load unknown
  session IDs (or that changed their schema between versions) may need a manual
  fix.

## Docs

| Document | Content |
| :--- | :--- |
| [Deployment](./docs/DEPLOYMENT.md) | Hub, client, multi-device setup, FAQ |
| [Release](./docs/RELEASE.md) | Versioning and update distribution |
| [Design wiki](./docs/wiki/) | Architecture, reverse-engineered agent storage, schemas |

## Security notes

- Runtime data (accounts, tokens, sessions) lives in `hub-data/` and
  `cloud-hub-storage/`, both gitignored
- The server uses only Node built-ins: no third-party npm supply chain in the
  request path
- Share links support an access code, a view cap and revocation

## Contributing

Issues and pull requests are welcome. Please read [NOTICE](./NOTICE) before
reusing substantial parts of the code; Apache 2.0 requires keeping the
attribution.

## License

[Apache-2.0](./LICENSE) © [NanYuJun](https://github.com/NanYuJun)
