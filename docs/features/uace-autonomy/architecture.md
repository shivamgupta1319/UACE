# FEAT-001 · Architecture (source of truth)

## Overview

Three additions layered onto the existing engine:

1. **Server CLI mode** — a non-MCP entrypoint so external processes (Claude Code hooks,
   scripts) can read/write the brain without speaking MCP.
2. **Host integration layer** (extension) — detect the AI host, auto-register the MCP
   server, and write rules/hooks for autonomous recall + save.
3. **Brain quality** — richer auto-capture, a smarter context packet, and memory lifecycle.

Existing modules are reused, not duplicated: `MemoryStore` (`src/memory.ts`), `scanProject`
(`src/scanner.ts`), `importClaudeSessions` (`src/transcripts.ts`), `openDb`/`tryEnableVectors`
(`src/db.ts`), `createEmbedder` (`src/embedder.ts`).

```
            ┌─────────────────────── Hosts ───────────────────────┐
            │  VS Code Copilot   Cursor   Claude Code   Antigravity│
            └───────┬──────────────┬───────────┬────────────┬─────┘
        MCP (stdio) │   API/config │  .mcp.json│  config    │
                    │              │  + hooks  │            │
        ┌───────────▼──────────────▼───────────▼────────────▼───┐
        │              UACE extension  (host integration)        │
        │  detectHost · registerMcp · writeRules · writeHooks    │
        └───────────────────────────┬───────────────────────────┘
                                     │ spawns
              ┌──────────────────────▼───────────────────────┐
              │     uace-mcp  (one binary, two modes)         │
              │  ┌─ MCP mode (server.ts) ─┐  ┌─ CLI mode ───┐ │
              │  │ 17 tools + new prompts │  │ context/save │ │
              │  └───────────┬────────────┘  └──────┬───────┘ │
              │              └──── MemoryStore ──────┘         │
              └───────────────────────┬───────────────────────┘
                                       │
                               ~/.uace/memory.db  (shared SQLite + sqlite-vec)
```

---

## C1 — Server CLI mode  (W1)

**New file `src/cli.ts`.** `src/server.ts` branches at startup: if `process.argv[2]` is a
known subcommand, run the CLI and exit; otherwise start the MCP stdio server (current
behavior, default — so `bin: uace-mcp` with no args is unchanged).

| Subcommand | Args | Output | Reuses |
|---|---|---|---|
| `context <project>` | `--query q`, `--semantic`, `--limit n` | context packet → stdout | `MemoryStore.buildContextPacket` |
| `save-session` | `--project p --from-transcript <path>` \| `--summary s --next s` | confirmation → stderr | `importClaudeSessions` parse helpers + `MemoryStore.saveSession` |
| `sync <path>` | `--project p` | summary → stderr | `scanProject` + `readRecentCommits` + import |

Rules:
- **stdout is reserved for the payload** (the hook injects stdout into context); all logs go
  to stderr. Mirrors the existing `console.log → stderr` guard in `server.ts:37`. **Stronger
  than the server guard:** the CLI must also silence `@huggingface/transformers`
  model-download progress (route to stderr / disable), since any stdout noise would corrupt
  the hook-injected context (see R9).
- **`context` is no-embed by DEFAULT** (recency + FTS only) so the recall fast path is fast
  enough for the Claude Code SessionStart 30s budget and Cursor's short MCP timeout. Semantic
  ranking runs only with `--semantic` / `--query` (model cold-start is opt-in). [Resolves R1.]
- Honors `UACE_DB` exactly like the server (`src/server.ts:46`).
- Exit non-zero only on hard failure; empty brain prints the existing "no memories" notice.

Refactor: extract the transcript-parsing helpers currently inside `importClaudeSessions`
so both the MCP `import_claude_sessions` tool and `cli save-session --from-transcript` call
the same code.

---

## C2 — Host integration layer  (W2)

**New file `extension/src/hostIntegration.ts`** + wiring in `extension/src/extension.ts`
(`autoSync`/`init`). Pure helpers, host-branched.

### Host detection
```ts
type Host = "vscode" | "cursor" | "antigravity" | "claude-code" | "unknown";
function detectHost(): Host  // vscode.env.appName + API probing
```
- `vscode.env.appName` contains "Cursor" / "Antigravity" / "Visual Studio Code".
- Cursor confirmed by presence of `vscode.cursor?.mcp?.registerServer`.
- "claude-code" is not an extension host; its setup is triggered when a `.claude/` dir
  exists in the workspace OR always offered (hooks are inert until `claude` runs there).

### MCP registration (per host)

| Host | Mechanism | Notes |
|---|---|---|
| VS Code | `vscode.lm.registerMcpServerDefinitionProvider` (existing `mcpProvider.ts`) | keep as-is; resolved globalStorage server path is correct here |
| Cursor | `vscode.cursor.mcp.registerServer({ name:"uace", server:{ command, args, env } })` | API, no file write; `unregisterServer` on dispose; fall back to Copy MCP Config if API absent |
| Claude Code | merge `<workspace>/.mcp.json` | `{ "mcpServers": { "uace": { "type":"stdio", "command":"npx", "args":["-y","uace-mcp"], "env" } } }` |
| Antigravity | **supported** — atomic merge `~/.gemini/antigravity/mcp_config.json` (path confirmed; runtime probe + AGENTS.md fallback for other OSes) | stdio `command`/`args` via `npx -y uace-mcp`; preserve `$typeName` + existing secrets |

**Server-path strategy (Resolves R2):** extension hosts (VS Code/Cursor) use the resolved
globalStorage `serverEntry` (already installed by `serverBootstrap.ts`). **Claude Code**
`.mcp.json` and hook scripts instead use **portable `npx -y uace-mcp [args]`** (matches the
existing `copyMcpConfig`), since Claude Code runs standalone and must not depend on the
extension's install path; absolute path only as a fallback when `npx` is unavailable.

`registerMcpForHost(host, runtime, serverEntry, env)` returns `{ method, needsReload }`.

### Rules + AGENTS.md
`writeRules(workspaceRoot, host)` writes a **canonical body** (one template constant) to:
- `AGENTS.md` (root) — always (cross-tool standard).
- `.cursor/rules/uace.mdc` — Cursor (frontmatter `description`, `globs: []`, `alwaysApply: true`).
- `.github/copilot-instructions.md` — VS Code.

All writes are **block-merges**: replace the content between `<!-- BEGIN UACE -->` /
`<!-- END UACE -->` markers, preserving everything else. Idempotent.

### Claude Code hooks
`writeClaudeHooks(workspaceRoot, runtime, serverEntry)`:
- Merge `.claude/settings.json`:
  ```json
  { "hooks": {
      "SessionStart": [{ "matcher": "startup|resume",
        "hooks": [{ "type":"command", "command":"<abs>/.claude/hooks/uace-recall.sh", "timeout": 30 }]}],
      "SessionEnd":   [{ "hooks": [{ "type":"command", "command":"<abs>/.claude/hooks/uace-save.sh" }]}]
  }}
  ```
- Write executable hook scripts (chmod 0755):
  - `uace-recall.sh` → `npx -y uace-mcp context "<project>"` (no-embed default; stdout → context).
  - `uace-save.sh` → reads stdin JSON, extracts `transcript_path`, calls
    `npx -y uace-mcp save-session --project "<project>" --from-transcript "$tp"`.
- Scripts use portable `npx` (R2) and an absolute `PATH`/node shim so they work without nvm
  PATH (the known GUI-launch gotcha).

### Consent + state
- `getAutonomyConsent(context)` → reads `workspaceState` (`uace.autonomy.consent` =
  `granted | declined-forever | undefined`). Prompt only when `undefined`.
- Setup is gated on consent; `UACE: Set Up Autonomy` command bypasses the prompt (explicit).
- **Pre-warm during setup (R1/cold-start decision):** after consent, the setup step warms the
  `npx uace-mcp` cache + embedding model in the background (reuse `serverBootstrap` install +
  one `context`/no-op invocation) so the first real session in Cursor/Claude is instant
  rather than hitting the ~30s–2min first-run download inside the host's MCP timeout.

---

## C3 — Richer session capture  (W3)

Extend `src/transcripts.ts` `parseTranscript`:
- Capture the **last assistant text** → `lastMessage` ("where we left off").
- Heuristic extraction of **decisions / next steps** (scan assistant text for lines
  starting with "Next steps", "TODO", "Decision", "I'll", "we should") → `decisions`/`nextSteps`.
- Keep first prompt + counts + files; raise files cap.
- `ParsedSession` gains `decisions?`, `nextSteps?`, `lastMessage?`; map into `saveSession`
  (`decisions`, `next_steps`, summary).
- Still **extraction-only** (no LLM). Tool naming: rules always reference `mcp__uace__*`
  explicitly to avoid Claude's built-in "save memory" shadowing.

---

## C4 — Smarter context packet  (W4)

Rewrite `MemoryStore.buildContextPacket` (`src/memory.ts:425`):
- **Default relevance is NON-semantic** (recency + layer priority), so the default packet
  never triggers embedding cold-start (R1). Implicit-query semantic ranking (using the last
  session's summary/next-steps as the query) runs **only when semantic is explicitly
  requested** (`--semantic`/`query`) AND the model is already warm.
- **Freshness:** annotate each memory with relative age from `updated_at`; **flag stale**
  working-memory (e.g. `> 14d` → "⚠ may be stale").
- **Dedupe:** drop near-duplicate lines (same `key`, or identical content) across sections.
- **Size cap:** total packet bounded (configurable `maxChars`, default ~6k) — truncate
  lowest-priority sections first (priority: Most-Relevant > working > last-session >
  long-term > commits > files).

---

## C5 — Memory lifecycle  (W5)

- **No new `confidence` column for v0.2.0** (R4 decision: rank on age/freshness only; add
  confidence later if needed). Reuse existing `created_at`/`updated_at` for age. **No schema
  migration required** this release.
- New MCP tool `prune_stale` (+ CLI parity): delete or down-rank working/session memories
  older than N days (dry-run by default, returns candidates). Reuses `deleteMemory`.
- Also cap/prune `file_events` (one row per save → unbounded; dashboard already
  `GROUP BY path`, so old rows are pure bloat) — R8.
- Supersede: already handled by key-based upsert (`saveMemory`); document the pattern.

---

## C6 — MCP prompts

Register two MCP **prompts** in `server.ts` (SDK `registerPrompt`):
- `continue-project` → returns a message that calls `get_project_context` for the workspace.
- `save-checkpoint` → guides the agent to call `save_session` with summary + next steps.
These give one-click flows in any MCP client (complements hooks/rules).

---

## Data model changes

| Table | Change |
|---|---|
| `memories` | **none** (R4: confidence deferred) |
| `sessions` | none — `decisions`/`next_steps` already exist |
| `file_events` | none structurally; `prune_stale` caps row growth (R8) |

**No schema migration this release.** Fully backward compatible with existing
`~/.uace/memory.db`.

## Antigravity config-path resolution (C5 — SPIKE RESOLVED)

**Confirmed on the user's machine (2026-06-29):** the real path is
`~/.gemini/antigravity/mcp_config.json` (the GitHub-guide path; the Medium `~/.gemini/config/`
path does NOT exist here). Schema is the standard stdio shape
`{ "mcpServers": { "<name>": { "command", "args", "env" } } }`.

Spike facts that constrain the implementation:
- **Antigravity owns/rewrites this file** and injects a `$typeName` string per server entry.
  Our merge MUST preserve unknown per-server keys (including `$typeName`) and never strip them.
  We do NOT write `$typeName` ourselves — Antigravity normalizes it.
- **The file contains secrets** (other servers carry tokens in `env`). The merge must be
  atomic (temp-file + rename), preserve every existing key, and **never log file contents**.
- `uace` is already present (manually added previously), proving auto-write is viable.
- Host detection: Antigravity is a VS Code fork (`~/.config/Antigravity/User/`,
  `~/.antigravity/extensions/`); detect via `vscode.env.appName` containing "Antigravity".

Runtime strategy: primary path `~/.gemini/antigravity/mcp_config.json`; if absent, probe
`~/.gemini/config/mcp_config.json` then create the primary. Cross-platform (macOS/Windows)
paths still need confirmation per-OS — keep the probe list, default to the primary.

## Versioning

- Server `uace-mcp`: minor bump (new CLI + prompts + tool) → `0.2.0`.
- Extension `uace-dashboard`: minor bump → `0.2.0`; pin `SERVER_VERSION` to the new server.
