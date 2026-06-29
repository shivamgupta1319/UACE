# FEAT-001 · Tasks

**Status legend:** TODO · IN_PROGRESS · DONE
**Delivery:** single PR from `master` (branch `feat/uace-autonomy`, commit per phase).
**Decisions (from review):** confidence column **deferred** (R4); Antigravity **supported**
auto-write — spike confirmed the path (R5); **pre-warm** during setup (R1/cold-start). All
applied to the docs.

| Phase | Task | Status |
|---|---|---|
| 0 | Branch `feat/uace-autonomy` + scaffolding | TODO |
| — | Spike: confirm Antigravity `mcp_config.json` path on machine (R5) | DONE — `~/.gemini/antigravity/mcp_config.json`; std stdio schema; preserve `$typeName`; file holds secrets |
| 1 | Server CLI mode (`src/cli.ts`: context [no-embed default] / save-session / sync) + extract transcript helpers | DONE — commit `f50305c` |
| 1 | Smoke: CLI round-trip + stdout purity (T1, T2, T9b) | DONE — `scripts/smoke-cli.ts` |
| 2 | `hostIntegration.ts` host detection + MCP auto-register (Cursor API; Claude `.mcp.json` via `npx`; Antigravity atomic merge of `~/.gemini/antigravity/mcp_config.json`) | DONE — `f44f56c` |
| 2 | JSON merge helper + idempotency tests (T3) | DONE — `smoke-hostconfig.ts` |
| 3a | `writeRules` (AGENTS.md + .cursor/rules + copilot-instructions, block-merge) | DONE — `28f03e3` |
| 3a | Consent flow + pre-warm + `Set Up`/`Remove Autonomy` commands + TreeView status (T4, T5) | DONE — `28f03e3` |
| 3b | `writeClaudeHooks` (settings.json merge + `npx`-based hook scripts) (T6) | DONE — `f44f56c`/`28f03e3` |
| 4 | MCP prompts `continue-project` / `save-checkpoint` | DONE — `5e?` |
| 4 | Richer transcript capture (lastMessage, decisions, next-steps) (T7) | DONE |
| 5 | Smarter context packet (non-semantic default, freshness/stale, dedupe, size cap) (T8) | DONE |
| 6 | Memory lifecycle: `prune_stale` (memories + file_events); **no** confidence column (T9) | DONE |
| 7 | Version bump 0.2.0 + READMEs + memory file update | DONE |
| — | `verify-feature` (automated) — see `verification-report.md` | DONE (automated); manual host matrix pending user |
| — | Open single PR `feat/uace-autonomy → master` | PENDING — user to open/push |

## Notes
- P1 (CLI) blocks P3b (Claude hooks). P2 (registration) before P3a/P3b.
- Manual host tests require building/installing the VSIX per host; see `verification.md`.
- After merge: publish server (npm) + extension (Open VSX / MS Marketplace), 2FA OTP needed.
