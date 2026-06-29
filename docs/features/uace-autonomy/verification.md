# FEAT-001 · Verification & Rollout

## Automated

```bash
npm run build      # tsc, no errors
npm run smoke      # extended: T1,T2,T7,T8,T9 (CLI round-trip, richer capture, packet, prune)
```
Extend `scripts/smoke.ts` to cover: CLI `context`/`save-session` round-trip, **`context`
stdout purity** (only the packet, no model/log noise — R9), JSON-merge idempotency, rules
block-merge idempotency, richer-capture field extraction, packet freshness/size-cap/dedupe,
and `prune_stale` dry-run (memories + file_events).

## Manual — per host (the autonomy acceptance core)

Build the VSIX (`cd extension && npx vsce package`) and install in each host. For each:

### VS Code (Copilot) — AC1
1. Install VSIX, open a project, accept consent.
2. Confirm the `uace` MCP server is listed for Copilot (no manual config).
3. In Copilot chat, confirm it can call `mcp__uace__get_project_context`.

### Cursor — AC1, AC3
1. Install (Open VSX), open a project, accept consent.
2. Confirm server registered via API (no `~/.cursor/mcp.json` edit needed) — server usable
   in chat; if API absent, confirm merged global config + Reload Window.
3. Confirm `.cursor/rules/uace.mdc` exists with `alwaysApply: true`; agent recalls context
   at session start.

### Claude Code — AC2 (true passive autonomy)
1. From the project dir, run `claude`; approve the `uace` server when prompted (`/mcp`).
2. **SessionStart:** confirm the context packet appears as context at session start with no
   prompt (check via the recall hook output).
3. Do some work, end the session; **SessionEnd:** confirm a new session row was saved
   (`uace-mcp context <proj>` shows it / dashboard lists it).
4. Verify `.mcp.json`, `.claude/settings.json`, `.claude/hooks/uace-*.sh` are present and
   well-formed; hook scripts use the absolute node path.

### Antigravity — AC1
1. Install (Open VSX), open a project, accept consent.
2. Confirm `mcp_config.json` got a merged `uace` entry at the resolved path; reload window;
   server connects. Confirm `AGENTS.md` / `.agents/rules` present.

### Cross-tool round-trip — AC4 (the headline demo)
1. In Claude Code, do work on a throwaway project; let SessionEnd auto-save.
2. Open the same project in Cursor; confirm the agent recalls the auto-saved work via the
   context packet — **without any manual `save_*` call**.

### Negatives
- Decline consent → confirm nothing is written (AC8).
- Re-run setup → confirm files unchanged (idempotent, AC7).
- `UACE: Remove Autonomy` → confirm only UACE blocks/keys/hooks removed.

## Rollout checklist
- [ ] All automated tests pass; `npm run build` clean.
- [ ] Manual matrix T10–T15 pass on the user's machine.
- [ ] Versions bumped (server 0.2.0, extension 0.2.0, `SERVER_VERSION`).
- [ ] READMEs updated (autonomy, hosts, consent, `Remove Autonomy`).
- [ ] Single PR `feat/uace-autonomy → master` opened with summary + manual test steps.
- [ ] After merge: `npm publish --otp` (uace-mcp 0.2.0), Open VSX + MS Marketplace
      (uace-dashboard 0.2.0); update memory file.

## Backout
- Autonomy is consent-gated and additive; declining or `Remove Autonomy` fully reverts host
  changes. Server CLI mode is inert unless invoked. Schema change is additive
  (`addColumnIfMissing`) so older server versions still open the DB.
