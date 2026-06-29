/**
 * Pure (vscode-free) helpers for wiring UACE into AI hosts: MCP config files,
 * rules / AGENTS.md, and Claude Code hooks. Kept free of the `vscode` import so
 * it can be unit-tested directly (see scripts/smoke-hostconfig.ts).
 *
 * Every file write is a NON-DESTRUCTIVE, idempotent merge:
 *  - JSON configs: parse → set only the `uace` entry (preserving every other key,
 *    including hosts' own fields like Antigravity's `$typeName`) → atomic rename.
 *  - Markdown rules: replace only the content between BEGIN/END UACE markers.
 *
 * The MCP server is referenced portably as `npx -y uace-mcp` so the config keeps
 * working regardless of where (or whether) the extension is installed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Portable stdio entry (`npx -y uace-mcp`). Good for hosts that run in a real
 * terminal (Claude Code) where `npx` is on PATH and we want latest-on-npm.
 */
export function npxServer(env?: Record<string, string>): McpServerSpec {
  const spec: McpServerSpec = { command: "npx", args: ["-y", "uace-mcp"] };
  if (env && Object.keys(env).length) spec.env = env;
  return spec;
}

/**
 * Absolute stdio entry (`<node> <serverEntry>`). Required for GUI hosts
 * (Antigravity, Cursor file fallback) which launch MCP servers WITHOUT node/npx
 * on PATH — `npx`-based configs fail there with "npx: not found". Mirrors how the
 * VS Code/Cursor registration APIs already launch the server.
 */
export function localServer(node: string, serverEntry: string, env?: Record<string, string>): McpServerSpec {
  const spec: McpServerSpec = { command: node, args: [serverEntry] };
  if (env && Object.keys(env).length) spec.env = env;
  return spec;
}

// ---------------------------------------------------------------------------
// Atomic JSON merge
// ---------------------------------------------------------------------------

/**
 * Read `file` (or {} if absent), let `mutate` edit the parsed object in place,
 * then write it back atomically. Throws if an existing file is not valid JSON —
 * we never clobber a config we can't safely parse.
 */
export function mergeJsonFile(file: string, mutate: (obj: Record<string, unknown>) => void): void {
  let obj: Record<string, unknown> = {};
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    if (raw.trim()) {
      try {
        obj = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error(`${file} is not valid JSON; left untouched.`);
      }
    }
  }
  mutate(obj);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.uace-tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  renameSync(tmp, file);
}

/** Merge a `uace` server into an `mcpServers` map, preserving all other servers
 *  and any extra keys on an existing `uace` entry (e.g. Antigravity's $typeName). */
export function upsertMcpServer(file: string, server: McpServerSpec): void {
  mergeJsonFile(file, (obj) => {
    const servers = (obj.mcpServers ??= {}) as Record<string, unknown>;
    const existing = (servers.uace as Record<string, unknown>) ?? {};
    servers.uace = { ...existing, command: server.command, args: server.args, ...(server.env ? { env: server.env } : {}) };
  });
}

/** Remove only the `uace` entry, leaving every other server intact. Returns true if removed. */
export function removeMcpServer(file: string): boolean {
  if (!existsSync(file)) return false;
  let removed = false;
  mergeJsonFile(file, (obj) => {
    const servers = obj.mcpServers as Record<string, unknown> | undefined;
    if (servers && "uace" in servers) {
      delete servers.uace;
      removed = true;
    }
  });
  return removed;
}

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

export function cursorMcpPath(home = homedir()): string {
  return join(home, ".cursor", "mcp.json");
}

/** Antigravity's MCP config. Path differs across docs/OSes — probe, default to
 *  the confirmed `~/.gemini/antigravity/` location. */
export function antigravityMcpPath(home = homedir()): string {
  const primary = join(home, ".gemini", "antigravity", "mcp_config.json");
  const alt = join(home, ".gemini", "config", "mcp_config.json");
  if (existsSync(primary)) return primary;
  if (existsSync(alt)) return alt;
  return primary;
}

export function claudeProjectMcpPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".mcp.json");
}

// ---------------------------------------------------------------------------
// Rules / AGENTS.md
// ---------------------------------------------------------------------------

export const UACE_BEGIN = "<!-- BEGIN UACE (auto-generated — edit outside this block) -->";
export const UACE_END = "<!-- END UACE -->";

/** Canonical instruction body, shared across every host's rules file. References
 *  explicit `mcp__uace__*` tool names so Claude's built-in "save memory" can't shadow them. */
export const UACE_RULES_BODY = `## Project memory (UACE)

This project uses **UACE** — a shared, cross-tool memory served over MCP (server name
\`uace\`). Treat it as your source of continuity across sessions and AI tools.

- **At the START of a session**, call \`mcp__uace__get_project_context\` with this
  project's name to load prior decisions, the current task, recent changes, and where
  the last session left off — before asking the user to re-explain anything.
- **When you make a durable decision, hit a gotcha, or change the architecture**,
  persist it with \`mcp__uace__save_memory\` (layer \`long-term\` for architecture/standards,
  \`working\` for the current task/TODOs).
- **At the END of a session or a meaningful checkpoint**, call \`mcp__uace__save_session\`
  with a short summary, key decisions, and next steps so the next session — in any tool —
  can continue seamlessly.

The project name is this workspace's folder name.`;

/** Insert/replace the UACE block inside existing markdown content. */
export function upsertBlock(existing: string, body: string): string {
  const block = `${UACE_BEGIN}\n${body}\n${UACE_END}`;
  const start = existing.indexOf(UACE_BEGIN);
  const end = existing.indexOf(UACE_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + UACE_END.length);
  }
  return existing.trim().length ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

/** Remove the UACE block (and surrounding blank lines). Returns the cleaned content. */
export function stripBlock(existing: string): string {
  const start = existing.indexOf(UACE_BEGIN);
  const end = existing.indexOf(UACE_END);
  if (start === -1 || end === -1 || end < start) return existing;
  const cleaned = existing.slice(0, start).trimEnd() + existing.slice(end + UACE_END.length).trimStart();
  return cleaned.trim().length ? cleaned.replace(/\n{3,}/g, "\n\n") : "";
}

/** Block-merge a markdown rules file (AGENTS.md, copilot-instructions.md). */
export function writeRulesMarkdown(file: string): void {
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, upsertBlock(existing, UACE_RULES_BODY));
}

/** Cursor's `.cursor/rules/uace.mdc` is wholly UACE-owned → write the full file with frontmatter. */
export function writeCursorRule(workspaceRoot: string): string {
  const file = join(workspaceRoot, ".cursor", "rules", "uace.mdc");
  const content = `---
description: UACE shared project memory — recall at session start, save at the end
globs: []
alwaysApply: true
---
${UACE_RULES_BODY}
`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

// ---------------------------------------------------------------------------
// Claude Code hooks
// ---------------------------------------------------------------------------

export function claudeDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".claude");
}

const RECALL_SCRIPT = (project: string) => `#!/usr/bin/env bash
# UACE SessionStart hook (auto-generated). Injects the project context packet
# into the new session via stdout. No-embed/fast path.
exec npx -y uace-mcp context "${project}"
`;

const SAVE_SCRIPT = (project: string) => `#!/usr/bin/env bash
# UACE SessionEnd hook (auto-generated). Saves a session summary from the
# transcript Claude Code passes on stdin. Best-effort; never blocks.
input=$(cat)
tp=$(printf '%s' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
[ -n "$tp" ] && exec npx -y uace-mcp save-session --project "${project}" --from-transcript "$tp"
exit 0
`;

/** Write the two hook scripts (executable) and merge them into .claude/settings.json. */
export function writeClaudeHooks(workspaceRoot: string, project: string): { recall: string; save: string } {
  const dir = join(claudeDir(workspaceRoot), "hooks");
  mkdirSync(dir, { recursive: true });
  const recall = join(dir, "uace-recall.sh");
  const save = join(dir, "uace-save.sh");
  writeFileSync(recall, RECALL_SCRIPT(project));
  writeFileSync(save, SAVE_SCRIPT(project));
  chmodSync(recall, 0o755);
  chmodSync(save, 0o755);

  const settings = join(claudeDir(workspaceRoot), "settings.json");
  mergeJsonFile(settings, (obj) => {
    const hooks = (obj.hooks ??= {}) as Record<string, unknown[]>;
    // Drop any prior UACE entries (idempotent), then add ours.
    const notUace = (arr: unknown[]) =>
      (Array.isArray(arr) ? arr : []).filter(
        (e) => !JSON.stringify(e).includes("uace-")
      );
    hooks.SessionStart = [
      ...notUace(hooks.SessionStart as unknown[]),
      { matcher: "startup|resume", hooks: [{ type: "command", command: recall, timeout: 30 }] },
    ];
    hooks.SessionEnd = [
      ...notUace(hooks.SessionEnd as unknown[]),
      { hooks: [{ type: "command", command: save }] },
    ];
  });
  return { recall, save };
}

/** Remove UACE hook entries from .claude/settings.json (leaves user hooks intact). */
export function removeClaudeHooks(workspaceRoot: string): void {
  const settings = join(claudeDir(workspaceRoot), "settings.json");
  if (!existsSync(settings)) return;
  mergeJsonFile(settings, (obj) => {
    const hooks = obj.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return;
    for (const key of ["SessionStart", "SessionEnd"]) {
      if (Array.isArray(hooks[key])) {
        hooks[key] = (hooks[key] as unknown[]).filter((e) => !JSON.stringify(e).includes("uace-"));
        if ((hooks[key] as unknown[]).length === 0) delete hooks[key];
      }
    }
  });
}
