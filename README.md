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
- 🤖 **Autonomous** — install the extension and it auto-registers the server, and (with consent) makes any AI tool *recall* context at session start and *save* a checkpoint at the end — no manual tool calls.
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

## Autonomous mode — *just install the extension*

The manual config above is optional. Install the **UACE — AI Memory** extension and,
after a one-time consent, it makes the whole loop run by itself:

- **Auto-registers the MCP server** in whatever host you're in — VS Code (Copilot
  provider), **Cursor** (`vscode.cursor.mcp` API), **Claude Code** (project `.mcp.json`),
  and **Antigravity** (`~/.gemini/antigravity/mcp_config.json`). All writes are atomic,
  non-destructive merges.
- **Writes rules so the AI uses the brain on its own** — a canonical `AGENTS.md` plus
  host-native files (`.cursor/rules/uace.mdc`, `.github/copilot-instructions.md`) telling
  the assistant to recall context at session start and save a checkpoint at the end.
- **Claude Code hooks for truly passive recall/save** — a `SessionStart` hook injects the
  context packet automatically (no model decision needed); a `SessionEnd` hook saves a
  session summary from the transcript. Both call the bundled CLI:

  ```bash
  uace-mcp context <project>                          # prints the context packet (fast, no-embed)
  uace-mcp save-session --project <p> --from-transcript <path>
  ```

Run **“UACE: Set Up Autonomy”** any time, or **“UACE: Remove Autonomy”** to cleanly remove
every UACE-written block, config entry, and hook.

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
| `prune_stale` | Find/delete stale working & session memories and old file events (dry-run by default; long-term is never touched). |
| `list_projects` / `get_dashboard` | Structured JSON snapshots for the VS Code dashboard. |
| `delete_memory` / `delete_session` / `delete_project` | Permanently remove a memory, session, or whole project (clears embeddings too). |

### MCP prompts

| Prompt | Purpose |
|--------|---------|
| `continue-project` | One-click: load `get_project_context` and continue where the last session left off. |
| `save-checkpoint` | One-click: save a session summary + decisions + next steps. |

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
  (`~/.claude/projects/<encoded-cwd>/*.jsonl`), extracting the opening prompt, key
  **decisions**, **next steps**, files touched, and the last assistant message
  (*"where we left off"*) into session memory with no manual `save_session`. It's idempotent
  (deduped by transcript id) and degrades to a no-op when no transcripts exist.

---

## VS Code dashboard

A companion sidebar extension lives in [extension/](extension/). It connects to this
server as an MCP client (no native modules in the editor host) and renders a tree of
your projects → memories / sessions / active files / commits, plus commands to **Save
Session**, **Continue Previous Session**, and **Set Up / Remove Autonomy** (see
[Autonomous mode](#autonomous-mode--just-install-the-extension) above). See
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
- [x] Phase 6 — **autonomy**: per-host MCP auto-registration, rules/`AGENTS.md`,
  Claude Code hooks, CLI mode, richer capture, freshness-aware packet, `prune_stale`

**Next:** React webview (richer timeline), more transcript sources (Cursor & others),
remote/HTTP transport, team/cross-machine sync.

---

## License

[MIT](./LICENSE) © [shivamgupta1319](https://github.com/shivamgupta1319)
