# Change Log

## 0.1.0

Initial release.

- Shared, local-first project memory across MCP-capable AI tools (Claude Code, Cursor,
  VS Code Copilot, …).
- Registers a local MCP server with VS Code natively — Copilot agent gets the memory
  tools with zero configuration.
- Auto-sync: scans the open workspace folder, ingests git history, imports recent Claude
  Code sessions, and watches for file changes.
- Semantic search over memories (local CPU embeddings) with keyword fallback.
- Project Brain sidebar: memory layers, sessions, active files, commits.
- Auto-detects Node (PATH, nvm, fnm, asdf, system); installs the engine on first run.
- "Copy MCP Config" command to connect Claude Code / Cursor.
