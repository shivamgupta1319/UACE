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
| 1 | Server CLI mode (`src/cli.ts`: context [no-embed default] / save-session / sync) + extract transcript helpers | TODO |
| 1 | Smoke: CLI round-trip + stdout purity (T1, T2, T9b) | TODO |
| 2 | `hostIntegration.ts` host detection + MCP auto-register (Cursor API; Claude `.mcp.json` via `npx`; Antigravity atomic merge of `~/.gemini/antigravity/mcp_config.json`) | TODO |
| 2 | JSON merge helper + idempotency tests (T3) | TODO |
| 3a | `writeRules` (AGENTS.md + .cursor/rules + copilot-instructions, block-merge) | TODO |
| 3a | Consent flow + pre-warm + `Set Up`/`Remove Autonomy` commands + TreeView status (T4, T5) | TODO |
| 3b | `writeClaudeHooks` (settings.json merge + `npx`-based hook scripts) (T6) | TODO |
| 4 | MCP prompts `continue-project` / `save-checkpoint` | TODO |
| 4 | Richer transcript capture (lastMessage, decisions, next-steps) (T7) | TODO |
| 5 | Smarter context packet (non-semantic default, freshness/stale, dedupe, size cap) (T8) | TODO |
| 6 | Memory lifecycle: `prune_stale` (memories + file_events); **no** confidence column (T9) | TODO |
| 7 | Version bump 0.2.0 + READMEs + memory file update | TODO |
| — | `verify-feature` + manual host matrix (T10–T15, T9c) | TODO |
| — | Open single PR `feat/uace-autonomy → master` | TODO |

## Notes
- P1 (CLI) blocks P3b (Claude hooks). P2 (registration) before P3a/P3b.
- Manual host tests require building/installing the VSIX per host; see `verification.md`.
- After merge: publish server (npm) + extension (Open VSX / MS Marketplace), 2FA OTP needed.
