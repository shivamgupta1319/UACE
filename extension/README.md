# UACE — AI Memory (VS Code extension)

A sidebar dashboard for the [Universal AI Context Engine](../README.md). It shows
your project's shared AI memory — layered memories, recent sessions, active files,
and commits — and lets you save/continue sessions from the editor.

It connects to the UACE MCP server as a client (spawning `node dist/server.js` over
stdio), so there are **no native modules in the extension host** and nothing extra
to rebuild. It reads the same `~/.uace/memory.db` every AI tool writes to.

## Prerequisites
1. Build the server once (from the repo root):
   ```bash
   cd .. && npm install && npm run build
   ```
2. Node.js must be reachable. If you installed Node via **nvm / asdf / fnm**, a
   GUI-launched VS Code won't have it on `PATH` — set `uace.nodePath` to the
   absolute binary (e.g. `~/.nvm/versions/node/v24.14.0/bin/node`). Find it with
   `which node`.

## Run it (development)
```bash
cd extension
npm install
npm run compile        # or: npm run watch
```
Then open the `extension/` folder in VS Code and press **F5** ("Run Extension").
In the new Extension Development Host window:

1. Open **Settings** → search **UACE** → set **`uace.serverPath`** to the absolute
   path of the built server, e.g. `/home/shivam/workspace/UACE/dist/server.js`.
   (Optionally set `uace.dbPath` to override the database location.)
2. Open the **Explorer** sidebar → **UACE Project Brain** view.

## Features
- **Tree view** — projects → Working / Long-Term / Session memory, Recent Sessions,
  Active Files, Recent Commits. Hover any item for full content.
- **UACE: Refresh** (↻ in the view title) — reload from the database.
- **UACE: Continue Previous Session** (⟲) — opens the full project context packet as
  a markdown document (the "open a new session and keep going" flow).
- **UACE: Save Session** — capture a session summary + next steps into shared memory.

## Settings
| Setting | Description |
|---------|-------------|
| `uace.serverPath` | Absolute path to the server entry (`dist/server.js`). Required. |
| `uace.nodePath` | Absolute path to the Node binary. Required for nvm/asdf/fnm installs. Defaults to `node` on `PATH`. |
| `uace.dbPath` | Optional `UACE_DB` override. Defaults to `~/.uace/memory.db`. |

> Packaging to a `.vsix` (via `vsce package`) is possible but not required for local
> use — F5 runs it directly from source.
