# Universal AI Context Engine (UACE)

Local-first **shared project memory** for AI coding assistants. Run one MCP
server; every MCP-capable tool (Claude Code, Cursor, …) reads and writes the same
"Project Brain" — so you can open a new AI session and continue **without
re-explaining the project**.

> Status: **Phase 5 (feature-complete MVP).** Core MCP memory server + project
> scanner & git intelligence + semantic search (local embeddings via sqlite-vec) +
> live file watcher & auto session capture + a **VS Code dashboard** ([extension/](extension/)).

## How it works

```
   Claude Code ─┐
   Cursor ──────┼──(MCP / stdio)──> UACE server ──> SQLite (~/.uace/memory.db)
   ChatGPT ─────┘                                   layered memory + sessions
```

One standard (MCP), one shared SQLite store. The assistant *pulls* context via
tool calls — the reliable path that works across every MCP client.

### Memory layers
- **long-term** — architecture, coding standards, folder structure, tech stack
- **working** — current task, TODOs, active branch, open issues
- **session** — recent decisions, prompts, next steps

### MCP tools exposed
| Tool | Purpose |
|------|---------|
| `get_project_context` | Pull the layered context packet + last session (call at session start); pass `query` for a semantically-ranked "Most Relevant" section |
| `save_memory` | Persist a fact/decision/standard (upsert via `key`); auto-embedded for semantic search |
| `search_memory` | Semantic (vector) search by meaning, with keyword fallback |
| `save_session` | Record a session summary for the next assistant |
| `list_sessions` | List recent sessions |
| `scan_project` | Auto-populate long-term memory from a repo: languages, frameworks, README, structure + ingest git commits |
| `get_recent_changes` | List recently ingested git commits (hash, date, message, files) |
| `reindex_memories` | Backfill embeddings for memories saved before semantic search was enabled |
| `watch_project` / `unwatch_project` | Watch a directory for live file changes (uncommitted work signal) |
| `get_active_files` | List recently changed files captured by the watcher |
| `import_claude_sessions` | Auto-capture recent Claude Code sessions from local transcripts (idempotent) |
| `list_projects` / `get_dashboard` | Structured JSON snapshots for the VS Code dashboard |

## Quick start

```bash
npm install
npm run smoke      # verify the memory core (no MCP client needed)
npm run build      # compile to dist/
```

The server runs over stdio:

```bash
npm run dev        # or: node dist/server.js
```

The shared database defaults to `~/.uace/memory.db`. Override with `UACE_DB`.

## Wire it into your assistants (the universal demo)

Point **both** tools at the **same** server so they share memory.

### Claude Code — `.mcp.json` (project root) or user settings
```json
{
  "mcpServers": {
    "uace": {
      "command": "node",
      "args": ["/home/shivam/workspace/UACE/dist/server.js"]
    }
  }
}
```

### Cursor — Settings → MCP → Add server (`~/.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "uace": {
      "command": "node",
      "args": ["/home/shivam/workspace/UACE/dist/server.js"]
    }
  }
}
```

### Acceptance test (proves cross-tool memory)
1. In **Claude Code**: ask it to `save_memory` a fact for project `myapp`.
2. In **Cursor**: ask it to `get_project_context` for `myapp`.
3. The fact appears — one memory, two tools. ✅

## Semantic search

`save_memory` embeds each memory with a local CPU model (`all-MiniLM-L6-v2`, 384-dim,
via Transformers.js) stored in [sqlite-vec](https://github.com/asg017/sqlite-vec).
`search_memory` and `get_project_context?query=` then retrieve by meaning. Everything
runs offline after a one-time (~30–90 MB) model download. If the model or sqlite-vec
can't load, the engine automatically falls back to keyword (FTS) search — nothing
breaks. Disable embeddings entirely with `UACE_NO_EMBED=1`; override the model with
`UACE_EMBED_MODEL` / `UACE_EMBED_DIM`.

## Live activity & session capture

`watch_project` uses [chokidar](https://github.com/paulmillr/chokidar) to track
create/modify/delete events (ignoring `node_modules`, `.git`, `dist`, …) — the
*uncommitted* work signal git can't give you — and surfaces them under "Recently
Active Files". `import_claude_sessions` reads Claude Code's local transcripts
(`~/.claude/projects/<encoded-cwd>/*.jsonl`), extracting the opening prompt, turn
counts, and files touched into session memory with no manual `save_session`. It's
idempotent (deduped by transcript id) and degrades to a no-op when no transcripts
exist. Watching lives for the duration of the MCP server process.

## VS Code dashboard

A sidebar extension lives in [extension/](extension/). It connects to this server
as an MCP client (no native modules in the editor host) and renders a tree of your
projects → memories / sessions / active files / commits, plus commands to **Save
Session** and **Continue Previous Session** (opens the context packet). See
[extension/README.md](extension/README.md) for F5 run instructions.

## Roadmap
~~Phase 2: project scanner + git intelligence~~ ✅ ·
~~Phase 3: sqlite-vec semantic search~~ ✅ ·
~~Phase 4: file watcher + auto session capture~~ ✅ ·
~~Phase 5: VS Code dashboard~~ ✅ — **MVP complete.**

Future: React webview (richer timeline), more transcript sources (Cursor/others),
remote/HTTP transport, packaged `.vsix`.
