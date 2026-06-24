# UACE — AI Memory

**Persistent, shared project memory for your AI coding assistants.** Open a new AI
session and keep going — no re-explaining your architecture, decisions, or progress.

UACE gives Claude Code, Cursor, VS Code Copilot, and any other MCP-capable tool **one
shared "Project Brain"** for each project: architecture and standards, current task and
TODOs, recent sessions, git history, and live file activity — all stored locally on your
machine and searchable by meaning.

## What you get

- **Shared memory across tools** — a fact saved in one AI tool is available in every other.
- **Auto-sync** — open a project folder and UACE automatically scans it (languages,
  frameworks, structure), ingests git history, imports your recent Claude Code sessions,
  and watches it for changes. No manual setup per project.
- **Semantic search** — find memories by meaning, not just keywords (local, private,
  CPU-only embeddings).
- **Project Brain sidebar** — browse memory, sessions, active files, and commits in the
  Explorer.
- **Works with VS Code Copilot out of the box** — the extension registers a local MCP
  server, so Copilot's agent can read and write your project memory with no config.

## Requirements

- **Node.js** on your machine (the local memory engine runs on it). UACE auto-detects
  Node from your PATH, nvm, fnm, asdf, or system install. If it can't find it, set
  `uace.nodePath` to your Node binary.
- VS Code **1.101+** (for the native MCP integration).

On first activation UACE installs its engine locally (one-time, ~1–2 min). After that it
starts instantly and works offline.

## Use it with Claude Code / Cursor / other tools

Run **“UACE: Copy MCP Config for Claude Code / Cursor”** from the Command Palette. It
generates a ready-to-paste command/snippet that points those tools at the same local
memory — so every assistant shares one brain.

## Commands

| Command | What it does |
|---------|--------------|
| UACE: Sync Current Project Now | Re-scan + import sessions + watch the open folder |
| UACE: Continue Previous Session | Open the full project context packet as markdown |
| UACE: Save Session | Capture a session summary + next steps |
| UACE: Copy MCP Config… | Snippets to connect Claude Code / Cursor |
| UACE: Refresh | Reload the sidebar |

## Settings

| Setting | Description |
|---------|-------------|
| `uace.autoSync` | Auto scan/import/watch the open folder on startup. Default `true`. |
| `uace.nodePath` | Override: absolute path to Node (only if auto-detect fails). |
| `uace.serverPath` | Override: path to a local server build (for development). |
| `uace.dbPath` | Override: memory database path. Default `~/.uace/memory.db`. |

## Privacy

Everything is **local-first**. Your memory lives in a SQLite database at
`~/.uace/memory.db`. Nothing is sent anywhere; embeddings run on your CPU.

---

*Built on the [Model Context Protocol](https://modelcontextprotocol.io). The engine is
also available standalone on npm as `uace-mcp`.*
