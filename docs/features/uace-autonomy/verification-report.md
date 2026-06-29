# FEAT-001 · Verification Report

Branch `feat/uace-autonomy`. Generated after implementing all phases. Single PR from
`master` (commit-per-phase). Status: **automated verification PASS; manual host matrix
pending on the user's machine.**

## Automated results

| Check | Result |
|-------|--------|
| `npm run build` (server, tsc) | ✅ clean — `uace-mcp@0.2.0` |
| `cd extension && npm run compile` (tsc) | ✅ clean — `uace-dashboard@0.2.0` |
| `npm run smoke` (core) | ✅ pass — incl. T7 richer capture, T8 packet freshness/stale/size-cap, T9 prune dry-run/apply |
| `scripts/smoke-cli.ts` | ✅ pass — T1/T2 CLI round-trip, **T9b stdout purity**, transcript dedupe |
| `scripts/smoke-hostconfig.ts` | ✅ pass — T3 merge preserves keys/$typeName/secrets, T4 rules idempotent, T5 strip-only-UACE, T6 malformed-config untouched, hooks |
| Compiled binary dispatch | ✅ `node dist/server.js context\|sync\|prune` run + exit; bare invocation still starts MCP server (stdout empty, clean SIGTERM) |
| Tool / prompt count | ✅ 18 tools (+`prune_stale`), 2 prompts (`continue-project`, `save-checkpoint`) |

## Acceptance criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 auto-register per host (VS Code/Cursor/Claude/Antigravity) | ✅ code; manual per-host pending | `hostIntegration.setupAutonomy` |
| AC2 Claude SessionStart injects / SessionEnd saves | ✅ code; manual pending | `writeClaudeHooks` + CLI `context`/`save-session` |
| AC3 rules instruct recall/save | ✅ | `AGENTS.md` + `.cursor/rules/uace.mdc` + copilot-instructions |
| AC4 cross-tool round-trip, no manual save | ✅ mechanism; manual demo pending | hooks/rules + shared DB |
| AC5 richer auto-capture (decisions/next/where-left-off) | ✅ | T7 |
| AC6 freshness/stale/dedupe/size-cap packet | ✅ | T8 |
| AC7 non-destructive, idempotent merges | ✅ | T3/T4/T5/T6 |
| AC8 graceful degradation + consent-gated | ✅ | consent flow; AGENTS.md fallback; CLI no-embed default |

## Manual host matrix (pending — requires building/installing the VSIX per host)

T10 VS Code · T11 Cursor · T12 Claude Code hooks · T13 Antigravity · T14 cross-tool
round-trip · T15 consent-declined · T9c pre-warm. Steps documented in `verification.md`.

## Rollout (post-merge, user-run)
1. `npm publish --otp=<code>` → `uace-mcp@0.2.0`.
2. Extension: `vsce package` → publish to Open VSX (`ovsx publish`) + MS Marketplace.
3. `SERVER_VERSION` is pinned to `0.2.0`, so the extension installs the matching engine.

## Notes / residual risk
- Manual host verification is the only outstanding item; all logic is unit/smoke-covered.
- Antigravity path confirmed on Linux (`~/.gemini/antigravity/mcp_config.json`); macOS/Windows
  fall back to the runtime probe + `AGENTS.md`.
- Claude Code hooks rely on `npx` being on PATH in the hook shell (true for CLI launches).
