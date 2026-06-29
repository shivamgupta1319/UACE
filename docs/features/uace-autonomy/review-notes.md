# FEAT-001 · Review Notes (Phase 2)

**Reviewer pass:** docs cross-checked against the live codebase (`src/`, `extension/src/`,
`scripts/smoke.ts`) and the two research findings.

## Summary verdict: **APPROVE WITH REQUIRED REVISIONS**

The design is sound and the autonomy approach is technically validated. Two issues (R1, R2)
are **load-bearing contradictions/risks that must be resolved in the docs before
implementation**. R3–R5 are recommended before coding; R6–R10 are notes to honor during
implementation.

Verified-true claims:
- `McpServer.registerPrompt` exists in `@modelcontextprotocol/sdk` → **C6 prompts viable**.
- `vscode.lm.registerMcpServerDefinitionProvider` is already used (`mcpProvider.ts`) → VS Code path correct.
- `copyMcpConfig` already emits portable `npx -y uace-mcp` configs → reusable, and confirms R2.
- `scripts/smoke.ts` (266 LOC, deterministic embedder, packet assertions) → easy to extend for new phases.

---

## Required revisions (block implementation)

### R1 (HIGH) — W4 implicit semantic ranking contradicts the SessionStart/CLI latency budget
`architecture.md` C4 makes the **default** packet run implicit-query *semantic* ranking
(using the last session as the query). But semantic search triggers embedding-model
cold-start. The existing `copyMcpConfig` literally warns that **Cursor's MCP startup timeout
is shorter than the first-run model load (~30s–2min)**, and the Claude `SessionStart` hook
has a 30s budget. Running embeddings on **every** session start / every `cli context` call
will slow or break autonomous recall — the opposite of the goal.
- **Edit:** Make `cli context` (the hook/recall fast path) **default to no-embeddings**
  (recency + FTS only). Implicit semantic ranking becomes opt-in (`--query` or a
  `--semantic` flag), or only runs when the model is already warm/cached. State this
  explicitly in `architecture.md` C1+C4 and `edge_cases_and_testing.md` (resolve the current
  "default packet no embeddings" vs. "implicit semantic ranking" contradiction).

### R2 (HIGH) — Claude Code `.mcp.json` + hooks must use portable `npx`, not extension globalStorage
`architecture.md` C2 says hooks/`.mcp.json` reference the "resolved node + server path." But
the extension installs the server into **its own `globalStorageUri`** (`serverBootstrap.ts`),
a path that changes on extension update/uninstall and may not exist when Claude Code runs
standalone. The existing `copyMcpConfig` already solved this with `npx -y uace-mcp`.
- **Edit:** For **Claude Code** `.mcp.json` and hook scripts, use `npx -y uace-mcp [args]`
  (portable), absolute path only as a fallback when npx is unavailable. Note the first-run
  download tradeoff and reuse the same "pre-warm" guidance `copyMcpConfig` already gives.
  Extension hosts (VS Code/Cursor) keep the resolved globalStorage path (correct there).

---

## Recommended before coding

### R3 (MED) — Phase 3 likely exceeds the 500-LOC cap
Phase 3 bundles rules templates + `AGENTS.md` + 3 host rule files + Claude hooks + settings
merge + hook scripts + consent + 2 commands + `package.json` contributions + 3 unit tests.
Realistically >500 changed lines.
- **Edit:** Split into **3a** (rules/`AGENTS.md` + consent + `Set Up`/`Remove` commands +
  contributions) and **3b** (Claude hooks: settings merge + hook scripts + tests). Update
  `implementation_plan.md` and `tasks.md`.

### R4 (MED) — `confidence` column is dead weight unless consumed
W5 adds `confidence` to `memories` but nothing reads it (W4 ranks by freshness/relevance).
- **Decision needed:** either wire `confidence` into packet ordering / `search_memory`, or
  drop it from scope and rank on age only. Record the choice in `architecture.md` C5.

### R5 (MED) — Antigravity is an unverifiable blocker; don't gate an AC on it
Research found **3 conflicting** `mcp_config.json` paths, no extension API, and we can't
confirm without the app. Making Antigravity auto-registration a hard acceptance criterion
risks blocking the PR.
- **Edit:** Demote Antigravity auto-write to **best-effort/optional**; guarantee Antigravity
  only via `AGENTS.md` + the existing **Copy MCP Config** fallback. Add a pre-build spike:
  "verify the real `mcp_config.json` path on the user's machine" before implementing the
  auto-write. Adjust AC1 wording in `understanding.md`.

---

## Notes to honor during implementation (no doc edit required)

- **R6 (LOW)** Cursor `registerServer` may show an approval prompt (unverified) and project
  `.cursor/mcp.json` has a known reload bug — always provide the Copy MCP Config fallback;
  prefer the API over file-writing. (Open question, already partly in edge doc.)
- **R7 (LOW)** Consent is per-`workspaceState`; reopening the folder under a different path
  re-prompts. Acceptable; "Never for this project" must still allow the manual command (doc
  already says so).
- **R8 (LOW)** `file_events` grows unbounded (one row per save). Consider capping/pruning it
  in W5's `prune_stale` (the dashboard already `GROUP BY path`, so old rows are pure bloat).
- **R9 (LOW)** **Critical for the hook path:** `@huggingface/transformers` can emit
  model-download progress; for `cli context`, whose **stdout is injected into the model's
  context**, any such noise corrupts it. The CLI must route ALL non-payload output to stderr
  (stronger than the existing `console.log → stderr` guard) and/or run no-embed by default
  (R1 makes this moot for the common path). Add a smoke assertion: `cli context` stdout
  contains only the packet.
- **R10 (LOW)** The "save memory" shadowing gotcha only affects natural-language phrasing;
  rules already reference explicit `mcp__uace__*` tool names — correct mitigation. Recall
  uses `get_project_context` (unshadowed), so no issue there.

## Open questions for the user — RESOLVED
1. **R4:** ✅ **Drop `confidence` for v0.2.0** — rank by age/freshness only.
2. **R5:** ✅ **SPIKE DONE → Antigravity promoted to SUPPORTED.** Path confirmed
   `~/.gemini/antigravity/mcp_config.json` (std stdio schema); auto-write via atomic merge
   (preserve `$typeName` + existing secrets). Runtime probe + AGENTS.md fallback for other OSes.
3. **R1/cold-start:** ✅ **Pre-warm during setup** — extension warms the npx cache + model
   after consent so the first session is instant.

## Required doc edits checklist (before `/execute-phase`) — DONE
- [x] `architecture.md` C1+C4: CLI `context` no-embed default; implicit semantic opt-in (R1).
- [x] `architecture.md` C2: Claude Code uses `npx -y uace-mcp` for `.mcp.json` + hooks (R2).
- [x] `architecture.md` C5: confidence dropped (R4); file_events pruning added (R8).
- [x] `implementation_plan.md` + `tasks.md`: split Phase 3 → 3a/3b (R3); demote Antigravity (R5);
      add pre-warm + Antigravity spike.
- [x] `understanding.md` AC1: Antigravity best-effort wording (R5).
- [x] `edge_cases_and_testing.md` + `verification.md`: CLI stdout-purity test (R9);
      resolved the embeddings-on-default-packet contradiction (R1); pre-warm test.
