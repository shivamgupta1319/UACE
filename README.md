# UACE — Universal AI Context Engine

> **Local-first, shared project memory for every AI coding assistant.**
> Run one MCP server and let Claude Code, Cursor, VS Code Copilot, and any other
> MCP-capable tool read and write the same **Project Brain** — so you can open a
> brand-new AI session and keep going **without re-explaining your project**.

<p align="center">
  <a href="https://www.npmjs.com/package/uace-mcp"><img alt="npm" src="https://img.shields.io/npm/v/uace-mcp.svg?color=cb3837&logo=npm"></a>
  <a href="https://www.npmjs.com/package/uace-mcp"><img alt="downloads" src="https://img.shields.io/npm/dm/uace-mcp.svg?color=cb3837"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/uace-mcp.svg?color=22c55e"></a>
  <img alt="node" src="https://img.shields.io/node/v/uace-mcp.svg?color=339933&logo=node.js&logoColor=white">
  <img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-compatible-6E56CF">
</p>

---

## Why UACE?

Every time you start a new AI chat, the assistant forgets everything — your
architecture, your conventions, the decision you made yesterday, the branch you're
on. You re-explain. Every tool keeps its *own* siloed memory, so context never
follows you from Claude Code to Cursor to Copilot.

**UACE fixes both problems with one idea:** a single local MCP server backed by a
shared SQLite store. Any MCP client *pulls* the same context via standard tool calls.

```
   Claude Code ─┐
   Cursor ──────┼──(MCP / stdio)──▶  UACE server  ──▶  SQLite (~/.uace/memory.db)
   Copilot ─────┘                                       layered memory + sessions
```

- 🔒 **Local-first & private** — everything stays on your machine. No cloud, no API keys.
- 🔁 **Shared across tools** — a fact saved in one assistant is instantly available in every other.
- 🧠 **Semantic search** — retrieve memories by *meaning*, with CPU-only offline embeddings.
- ⚙️ **Zero-config sync** — auto-scan repos, ingest git history, import past sessions, watch live edits.
- 📦 **One command to run** — `npx uace-mcp`. No build step, no native-module headaches.

---

## Quick start

UACE is an MCP **stdio** server. Most clients just need a `command` to launch it —
`npx uace-mcp` handles install and run in one step.

### Claude Code

Add to `.mcp.json` in your project root (or your user-level MCP config):

```json
{
  "mcpServers": {
    "uace": {
      "command": "npx",
      "args": ["-y", "uace-mcp"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` → **Settings → MCP → Add server**:

```json
{
  "mcpServers": {
    "uace": {
      "command": "npx",
      "args": ["-y", "uace-mcp"]
    }
  }
}
```

### VS Code Copilot

Use the companion **UACE — AI Memory** extension for a fully zero-config install
(it bootstraps the server and registers the MCP endpoint automatically), or add the
same `npx uace-mcp` server to your MCP settings manually.

> **Point every tool at the same server** and they share one Project Brain. That's the
> whole trick.

### Prove it works (the universal demo)

1. In **Claude Code**, ask it to `save_memory` a fact for project `myapp`.
2. In **Cursor**, ask it to `get_project_context` for `myapp`.
3. The fact shows up — **one memory, two tools.** ✅

---

## Install

```bash
# Run on demand (recommended) — always the latest published version
npx uace-mcp

# …or install globally
npm install -g uace-mcp
uace-mcp
```

**Requirements:** Node.js **≥ 20**. The shared database lives at `~/.uace/memory.db`
(override with `UACE_DB`).

---

## How it works

UACE organizes everything it knows about a project into three memory layers, then
serves them to assistants through a small set of MCP tools.

### Memory layers

| Layer | Holds |
|-------|-------|
| **long-term** | architecture, coding standards, folder structure, tech stack |
| **working** | current task, TODOs, active branch, open issues |
| **session** | recent decisions, prompts, next steps |

### MCP tools

| Tool | Purpose |
|------|---------|
| `get_project_context` | Pull the layered context packet + last session (call at session start). Pass `query` for a semantically-ranked **Most Relevant** section. |
| `save_memory` | Persist a fact / decision / standard (upsert by `key`); auto-embedded for semantic search. |
| `search_memory` | Semantic (vector) search by meaning, with keyword fallback. |
| `save_session` | Record a session summary for the next assistant. |
| `list_sessions` | List recent sessions. |
| `scan_project` | Auto-populate long-term memory from a repo: languages, frameworks, README, structure + ingest git commits. |
| `get_recent_changes` | List recently ingested git commits (hash, date, message, files). |
| `reindex_memories` | Backfill embeddings for memories saved before semantic search was enabled. |
| `watch_project` / `unwatch_project` | Watch a directory for live file changes (the uncommitted-work signal). |
| `get_active_files` | List recently changed files captured by the watcher. |
| `import_claude_sessions` | Auto-capture recent Claude Code sessions from local transcripts (idempotent). |
| `list_projects` / `get_dashboard` | Structured JSON snapshots for the VS Code dashboard. |

---

## Semantic search

`save_memory` embeds each memory with a local CPU model (`all-MiniLM-L6-v2`, 384-dim,
via Transformers.js) stored in [sqlite-vec](https://github.com/asg017/sqlite-vec).
`search_memory` and `get_project_context?query=` then retrieve by meaning. Everything
runs **offline** after a one-time (~30–90 MB) model download. If the model or sqlite-vec
can't load, the engine automatically falls back to keyword (FTS) search — nothing breaks.

---

## Live activity & session capture

- **File watcher** — `watch_project` uses [chokidar](https://github.com/paulmillr/chokidar)
  to track create/modify/delete events (ignoring `node_modules`, `.git`, `dist`, …) and
  surfaces them under **Recently Active Files** — the *uncommitted* work signal git can't give you.
- **Session import** — `import_claude_sessions` reads Claude Code's local transcripts
  (`~/.claude/projects/<encoded-cwd>/*.jsonl`), extracting the opening prompt, turn counts,
  and files touched into session memory with no manual `save_session`. It's idempotent
  (deduped by transcript id) and degrades to a no-op when no transcripts exist.

---

## VS Code dashboard

A companion sidebar extension lives in [extension/](extension/). It connects to this
server as an MCP client (no native modules in the editor host) and renders a tree of
your projects → memories / sessions / active files / commits, plus commands to **Save
Session** and **Continue Previous Session** (which opens the context packet). See
[extension/README.md](extension/README.md) for details.

---

## Configuration

All configuration is via environment variables — none are required.

| Variable | Default | Description |
|----------|---------|-------------|
| `UACE_DB` | `~/.uace/memory.db` | Path to the shared SQLite database. |
| `UACE_NO_EMBED` | _(unset)_ | Set to `1` to disable embeddings entirely (keyword search only). |
| `UACE_EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` | Override the embedding model. |
| `UACE_EMBED_DIM` | `384` | Embedding dimension (must match the model). |

---

## Local development

```bash
git clone https://github.com/shivamgupta1319/UACE.git
cd UACE
npm install
npm run smoke      # verify the memory core (no MCP client needed)
npm run build      # compile TypeScript to dist/
npm run dev        # run the server over stdio (tsx)
```

---

## Roadmap

- [x] Phase 1 — local-first MCP memory server (layered memory + sessions)
- [x] Phase 2 — project scanner + git intelligence
- [x] Phase 3 — sqlite-vec semantic search
- [x] Phase 4 — file watcher + auto session capture
- [x] Phase 5 — VS Code dashboard — **MVP complete**

**Next:** React webview (richer timeline), more transcript sources (Cursor & others),
remote/HTTP transport, packaged `.vsix`.

---

## License

[MIT](./LICENSE) © [shivamgupta1319](https://github.com/shivamgupta1319)
