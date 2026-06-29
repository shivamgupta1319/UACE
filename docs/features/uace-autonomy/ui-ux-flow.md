# FEAT-001 · UI / UX Flow

The extension surface is minimal (a TreeView dashboard + commands). Autonomy adds a small
amount of UX: a one-time consent, status feedback, and a manual escape hatch. No webview.

## 1. First-run consent (the only required interaction)

On activation, after the server is ensured and the host detected, show **once per workspace**:

```
┌─────────────────────────────────────────────────────────────┐
│ UACE: set up autonomous context for "smart-trading"?         │
│ This registers the MCP server and writes AGENTS.md + rules    │
│ (and, in Claude Code, session hooks) so any AI tool can       │
│ continue this project without re-explaining it.               │
│                                                               │
│   [ Set up ]   [ Not now ]   [ Never for this project ]       │
└─────────────────────────────────────────────────────────────┘
```

- **Set up** → run full autonomy setup (register MCP, write rules/hooks, auto-sync).
- **Not now** → skip this session; ask again next activation.
- **Never for this project** → persist a `workspaceState` flag; never prompt again (manual
  command still available).

Rationale: we write into the user's repo and host config, so a single explicit consent is
the safe minimum. After consent, everything is automatic.

## 2. Status feedback

- A `withProgress` window toast during setup: *"UACE: registering server, writing rules…"*.
- The existing TreeView gains a top status row when not fully wired, e.g.
  *"⚠ Autonomy not set up — run 'UACE: Set Up Autonomy'"* or *"✓ Autonomous (Claude Code hooks active)"*.
- On host-specific limits, an info message, e.g. *"Antigravity MCP config written — reload
  the window for it to take effect."*

## 3. Commands (Command Palette)

| Command | Behavior |
|---|---|
| `UACE: Set Up Autonomy` | Run the full setup manually (re-runnable; same as consent → Set up). |
| `UACE: Remove Autonomy` | Remove the UACE-marked blocks from rules/config + hooks (clean uninstall). |
| `UACE: Sync Now` | Existing — scan + import + watch. |
| `UACE: Continue Previous Session` | Existing — opens the context packet as markdown. |
| `UACE: Copy MCP Config` | Existing — kept as a fallback for unsupported hosts. |

## 4. Generated-file UX (what the user sees in their repo)

All written blocks are clearly delimited so the user understands and can hand-edit:

```md
<!-- BEGIN UACE (auto-generated; safe to edit below this line is ignored on re-sync) -->
## Project memory (UACE)
At the start of a session, call the `mcp__uace__get_project_context` tool for this project…
…at the end, call `mcp__uace__save_session` with a summary + next steps…
<!-- END UACE -->
```

- `AGENTS.md` (root): canonical block (covers Cursor/Copilot/Claude/Antigravity).
- `.cursor/rules/uace.mdc`: same body + frontmatter `alwaysApply: true`.
- `.github/copilot-instructions.md`: same body.
- `.claude/settings.json` + `.claude/hooks/uace-*.sh`: hooks (Claude Code only).

## 5. Failure / edge UX

- Consent declined → nothing written; TreeView shows the "not set up" row.
- Node not found → existing `uace.nodePath` guidance message (unchanged).
- Config file unreadable/locked → error toast, leave the file untouched, fall back to
  "Copy MCP Config".
