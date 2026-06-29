# FEAT-001 — UACE Autonomy + Useful-Brain Overhaul · Understanding

## Problem

UACE today gives multiple AI assistants a shared "Project Brain" (local SQLite served over
MCP), but two gaps stop it from delivering its own promise — *"open a new AI session and
continue working without re-explaining the project."*

1. **The brain stays mostly empty unless the user manually curates it.** Auto-sync captures
   only shallow scan facts (`src/scanner.ts`) and metadata-only session stubs
   ("12 prompts / 15 replies", `src/transcripts.ts:114-117`). The high-value memory —
   decisions, gotchas, current task, "where we left off" — only lands via the **manual**
   `save_memory` / `save_session` tools, and nothing makes an AI call them organically.
2. **It is not autonomous.** Outside VS Code Copilot the user must hand-wire the MCP server
   (`~/.cursor/mcp.json`, etc.), and nothing makes the AI *read* context at session start.
   The core promise depends on manual discipline.

## Goal

Install the extension and **nothing else**:

- The MCP server **auto-registers** in whatever host is running (VS Code, Cursor, Claude
  Code, Antigravity).
- The assistant **auto-recalls** project context at session start and **auto-saves** a
  checkpoint at session end — without the user (or model) having to remember.
- The captured brain is **genuinely useful** (real decisions/next-steps, fresh & relevant),
  not a turn-count stub.

## Actors

| Actor | Role |
|---|---|
| **Developer (user)** | Installs the extension once; works normally across AI tools. |
| **AI assistant** | Any MCP-capable host (Claude Code, Cursor, Copilot, Antigravity). Consumes context, writes back. |
| **UACE extension** | Detects host, registers MCP, writes rules/hooks, runs auto-sync. |
| **UACE server** | MCP stdio server + new CLI mode; owns the shared SQLite brain. |

## User flows

### F1 — First install (zero manual setup)
1. User installs `uace-dashboard` from the marketplace of their tool.
2. On activation the extension detects the host, ensures the server binary, and shows a
   **one-time consent**: *"Set up autonomous context for this project? (writes AGENTS.md +
   rules + registers the MCP server)"*.
3. On accept: MCP server registered (API or merged config), rules/`AGENTS.md` + (for Claude
   Code) hooks written, workspace auto-synced (scan + import + watch).

### F2 — Continue in any tool (autonomous recall)
1. User opens the project in tool B and starts a session.
2. Context loads automatically — via the Claude Code SessionStart hook (true passive
   injection) or via the always-applied rules file instructing the agent to call
   `get_project_context`.
3. The assistant continues without the user re-explaining anything.

### F3 — End of work (autonomous save)
1. Session ends (or the agent hits a checkpoint).
2. A checkpoint is saved — via the Claude Code SessionEnd hook (reads the transcript →
   CLI save) or via the rules instruction to call the `save-checkpoint` flow.
3. The next session in any tool sees the updated brain.

## Acceptance criteria

- **AC1** After install + consent, opening the project in VS Code, Cursor, Claude Code, and
  **Antigravity** registers the MCP server with **no** manual config editing (Antigravity via
  atomic merge of `~/.gemini/antigravity/mcp_config.json`, path confirmed by the R5 spike;
  runtime path-probe + AGENTS.md fallback covers other OSes).
- **AC2** In Claude Code, a SessionStart hook injects the context packet automatically; a
  SessionEnd hook saves a session summary automatically.
- **AC3** In Cursor/Copilot/Antigravity, an always-applied rules file (or `AGENTS.md`)
  instructs the agent to recall at start and checkpoint at end; verified the agent does so.
- **AC4** A cross-tool round-trip works: work in tool A → checkpoint auto-saved → open
  tool B → context packet reflects the new work, with **no manual `save_*` calls**.
- **AC5** Auto-captured session summaries include "where we left off" and decisions/next
  steps, not just turn counts.
- **AC6** The default context packet (no query) is freshness-aware, deduped, relevance-ranked,
  and size-capped; stale working memory is flagged.
- **AC7** All config writes are **non-destructive merges** (existing keys preserved) and
  **idempotent** (safe to re-run); a clearly-marked UACE block is used for rules files.
- **AC8** Everything degrades gracefully: if a host lacks a capability (e.g. no hooks), the
  rules-file path still provides recall/save; if consent is declined, nothing is written.

## Non-goals (this feature)

- Team / cross-machine sync of the brain (stays local-first; future feature).
- LLM-based summarization in the server (capture stays extraction-only; the calling agent
  does any summarizing).
- Replacing the existing manual tools (they remain; autonomy is layered on top).
