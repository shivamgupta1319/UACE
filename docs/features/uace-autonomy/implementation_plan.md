# FEAT-001 · Implementation Plan

**Delivery:** a **single PR from `master`** containing all phases (per user instruction —
not one PR per phase). Branch once (`feat/uace-autonomy`), commit per phase for reviewable
history, open one PR at the end.

Each phase below is ≤ 500 changed lines and independently compilable/testable. Order is
chosen so the core promise (autonomy) lands first.

---

## Phase 0 — Branch + scaffolding  (~30 LOC)
- Create branch `feat/uace-autonomy` off `master`.
- No behavior change. Add doc cross-links if needed.
- **Commit:** `chore(feat-001): branch + scaffolding`.

## Phase 1 — Server CLI mode  (W1, ~220 LOC)  ← linchpin
- Extract transcript-parsing helpers from `importClaudeSessions` in `src/transcripts.ts`
  into reusable functions.
- New `src/cli.ts`: `context`, `save-session`, `sync` subcommands reusing `MemoryStore`,
  `scanProject`, `readRecentCommits`, parse helpers. stdout = payload, stderr = logs.
- Branch in `src/server.ts` on `argv[2]`; default (no arg) keeps MCP mode.
- `package.json`: confirm `bin` still maps `uace-mcp` → `dist/server.js`; CLI is via args.
- Extend `scripts/smoke.ts`: assert `context`/`save-session` round-trip.
- **Commit:** `feat(server): CLI mode (context/save-session/sync) for hook + script use`.

## Phase 2 — Host integration: MCP auto-registration  (W2a, ~260 LOC)
- New `extension/src/hostIntegration.ts`: `detectHost`, `registerMcpForHost`
  (Cursor API; Claude `.mcp.json` merge using **portable `npx -y uace-mcp`**, R2;
  Antigravity atomic merge of `~/.gemini/antigravity/mcp_config.json` — **supported**, path
  confirmed by R5 spike; runtime probe + AGENTS.md fallback for other OSes), atomic JSON
  merge helper (temp-file + rename; preserve unknown keys incl. Antigravity's `$typeName` and
  existing servers' secret `env`; never log contents).
- Wire into `extension/src/extension.ts` `init()`: keep VS Code provider; add other hosts.
- Reuse the existing MCP-config string builder used by `Copy MCP Config` (already `npx`-based).
- **Commit:** `feat(extension): auto-register MCP server per host (Cursor/Claude/Antigravity)`.

## Phase 3a — Rules + AGENTS.md + consent + commands  (W2b-1, ~240 LOC)
- `hostIntegration.ts`: `writeRules` (AGENTS.md + `.cursor/rules/uace.mdc` +
  `.github/copilot-instructions.md`, block-merge). Canonical rules body constant (references
  `mcp__uace__*` tool names explicitly; recall uses `get_project_context`).
- Consent flow (`workspaceState`), **pre-warm step** (warm npx cache + model after consent,
  R1/cold-start), `UACE: Set Up Autonomy` + `UACE: Remove Autonomy` commands, TreeView
  status row, `package.json` command + menu contributions.
- Tests: block-merge idempotency, remove-only-UACE (T4, T5).
- **Commit:** `feat(extension): autonomous recall via rules/AGENTS.md + consent + pre-warm`.

## Phase 3b — Claude Code hooks  (W2b-2, ~200 LOC)
- `hostIntegration.ts`: `writeClaudeHooks` — merge `.claude/settings.json` + write executable
  hook scripts (`uace-recall.sh`/`uace-save.sh`) using **portable `npx -y uace-mcp`** (R2).
- Test: malformed config untouched (T6); settings merge idempotent.
- **Commit:** `feat(extension): Claude Code SessionStart/SessionEnd hooks for passive recall/save`.

## Phase 4 — MCP prompts + richer session capture  (W3 + C6, ~180 LOC)
- `server.ts`: register `continue-project` + `save-checkpoint` prompts.
- `src/transcripts.ts`: capture `lastMessage`, heuristic `decisions`/`nextSteps`, larger
  files cap; thread into `saveSession`.
- **Commit:** `feat(server): MCP prompts + richer transcript capture (decisions/next-steps)`.

## Phase 5 — Smarter context packet  (W4, ~220 LOC)
- Rewrite `MemoryStore.buildContextPacket`: implicit-query relevance, freshness/stale flags,
  dedupe, size cap (config `maxChars`).
- Smoke: assert stale flag + size cap + dedupe.
- **Commit:** `feat(server): freshness-aware, ranked, size-capped context packet`.

## Phase 6 — Memory lifecycle  (W5, ~120 LOC)
- **No `confidence` column** (R4 — deferred). No schema migration.
- `memory.ts` + `server.ts`: `prune_stale` tool (dry-run default) reusing `deleteMemory`;
  also caps `file_events` growth (R8); CLI parity.
- **Commit:** `feat(server): memory lifecycle — prune_stale (memories + file_events)`.

## Phase 7 — Version bump, docs, README  (~120 LOC)
- Bump server `0.2.0`, extension `0.2.0`, `SERVER_VERSION`.
- Update root `README.md` + `extension/README.md` (autonomy, hosts, consent).
- Update `tasks.md` statuses; update memory file.
- **Commit:** `chore(release): v0.2.0 — autonomy + useful-brain; docs`.

## Final — Single PR
- `verify-feature` pass, then open **one** PR `feat/uace-autonomy → master` summarizing all
  phases, files touched, and manual cross-tool test steps.

---

## Estimated total
~1,560 changed lines across 8 commits in one PR (phases 0,1,2,3a,3b,4,5,6,7). Server-side
phases (1, 4, 5, 6) are unit/smoke-testable in isolation; extension phases (2, 3a, 3b) need
manual per-host verification.

## Sequencing rationale
CLI mode (P1) must precede Claude hooks (P3b). MCP registration (P2) before rules/hooks
(P3a/P3b) so a registered server exists for the agent to call. Brain-quality phases (4–6) are
independent and can be reordered if needed.

## Pre-build spike (R5) — DONE
Antigravity path confirmed: `~/.gemini/antigravity/mcp_config.json` (standard stdio
`mcpServers` schema). Antigravity injects `$typeName` per entry and the file holds other
servers' secrets → merge must be atomic + preserve-all + non-logging. Antigravity is now a
**supported** auto-write host (was best-effort).
