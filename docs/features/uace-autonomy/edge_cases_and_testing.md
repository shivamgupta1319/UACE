# FEAT-001 · Edge Cases, Security & Test Matrix

## Security & trust

| Concern | Mitigation |
|---|---|
| **Writing executable hook scripts into the user's repo** (`.claude/hooks/*.sh`) | Only after explicit consent; scripts are minimal, audit-friendly, marked auto-generated; `UACE: Remove Autonomy` deletes them. Hooks call only the local UACE CLI. |
| **Modifying host MCP config** (`.mcp.json`, `mcp_config.json`) | Non-destructive merge: parse → add only the `uace` key → write atomically; never overwrite or drop unknown servers. Back up nothing the user didn't author. |
| **Arbitrary code execution via hooks** | Hook commands are fixed strings the extension writes (resolved node + server path); no interpolation of untrusted input. Transcript path comes from Claude Code's own hook payload. |
| **First-use MCP approval** | Respect the host's one-time approval gate (Claude `/mcp`, Cursor) — do not attempt to bypass it. |
| **Prompt-injection from repo content into rules** | Rules body is a fixed template constant, not derived from repo content. AGENTS.md content outside the UACE block is never executed by us. |
| **Secrets** | CLI/hooks never read `.env*`; never log DB contents to stdout beyond the requested packet; `UACE_DB` path only. |
| **Path traversal in CLI args** | Validate `--from-transcript`/`sync` paths exist and are files/dirs; reject otherwise. |

## Edge cases

### Host integration
- **Host undetectable** (`unknown`) → write `AGENTS.md` only (cross-tool), skip host-specific
  steps; show info message.
- **Cursor API absent** (older Cursor) → fall back to merging `~/.cursor/mcp.json` + advise
  Reload Window (research: project-level `.cursor/mcp.json` has a reload bug; prefer global).
- **Antigravity path ambiguity** → probe candidate paths; if none exist, create the
  GitHub-guide path; log which was used. Never write to two locations.
- **No workspace folder open** → skip setup; nothing to anchor a project to.
- **Multi-root workspace** → run per folder (existing `localFolders()` pattern), one project
  id per root.
- **Config file is malformed JSON** → do not clobber; surface an error toast and skip that
  host's registration, leave the file untouched.
- **Re-run / idempotency** → block-merge by markers; JSON merge keyed by `uace`; running
  setup twice yields an identical file (assert in tests).
- **Consent declined / "never"** → nothing written; persisted so we don't re-prompt.
- **`Remove Autonomy`** → removes only UACE-marked blocks, the `uace` MCP key, and UACE
  hook scripts/entries; leaves user content intact.

### CLI mode
- **No memories for project** → `context` prints the existing "no memories" notice, exit 0
  (hook injects a benign line, not an error).
- **Semantic search unavailable** (`UACE_NO_EMBED=1` / model missing) → FTS fallback, as today.
- **`context` is no-embed by default** (R1): the recall fast path never loads the embedding
  model, so it stays within the SessionStart 30s / Cursor MCP timeout. Semantic is opt-in
  (`--semantic`/`--query`) and only used when the model is already warm.
- **Subcommand collides with a real first arg** → only a fixed allowlist of subcommands
  triggers CLI mode; anything else → MCP server (preserves `uace-mcp` bare-launch behavior).
- **stdout discipline** → any library noise must go to stderr or it corrupts hook context
  injection (same risk class as the MCP JSON-RPC guard).

### Claude Code hooks
- **SessionStart timeout** (default 10s; embeddings cold-start can be slow) → set
  `timeout: 30`; the recall script should be fast (DB read only — no model load needed for
  the default packet path; only `--query` triggers embeddings).
- **Transcript format drift** (`.jsonl` not officially stable) → parse defensively, skip
  unparseable lines (existing behavior), never crash the hook (always exit 0).
- **SessionEnd cannot block** → save is best-effort/observational; failure is logged, never
  fatal.
- **nvm/GUI PATH gotcha** → hook scripts use the absolute resolved node path, not bare `node`.

### Brain quality
- **Stale "current task"** → flagged `⚠ may be stale` after threshold; not deleted unless
  `prune_stale` is run.
- **Packet exceeds size cap** → truncate lowest-priority sections first; never drop the
  Most-Relevant / working sections silently without a "(truncated)" note.
- **Duplicate scan facts vs. manual memories** → dedupe by key + content equality.
- **`prune_stale` over-deletion** → dry-run by default, returns candidates; deletion only
  with an explicit flag.

## Test matrix

| ID | Scenario | Type | Expected |
|---|---|---|---|
| T1 | `cli context <proj>` round-trip | smoke | prints packet to stdout; logs on stderr |
| T2 | `cli save-session --from-transcript` | smoke | session row created, deduped on re-run |
| T3 | JSON merge preserves existing `mcpServers` keys | unit | only `uace` added |
| T4 | Rules block-merge idempotent | unit | second run = identical file |
| T5 | `Remove Autonomy` removes only UACE blocks | unit | user content intact |
| T6 | Malformed config file | unit | untouched + error surfaced |
| T7 | Richer capture extracts decisions/next-steps/lastMessage | unit | fields populated from fixture transcript |
| T8 | Packet: stale flag + size cap + dedupe | smoke | flags present, ≤ maxChars, no dupes |
| T9 | `prune_stale` dry-run vs. apply (memories + file_events) | smoke | dry-run deletes nothing |
| T9b | `cli context` stdout purity (R9) | smoke | stdout = packet only, no model/log noise |
| T9c | Pre-warm after consent hides first-run download (R1) | manual | first real session is instant |
| T10 | VS Code: MCP auto-registers (provider) | manual | server appears to Copilot |
| T11 | Cursor: `registerServer` API path | manual | server usable, no file edit |
| T12 | Claude Code: SessionStart injects, SessionEnd saves | manual | context appears; summary saved |
| T13 | Antigravity: config merge-write + reload | manual | server connects after reload |
| T14 | Cross-tool round-trip (AC4) | manual | tool B sees tool A's auto-saved work |
| T15 | Consent declined | manual | nothing written |

Manual tests (T10–T15) are documented step-by-step in `verification.md`.
