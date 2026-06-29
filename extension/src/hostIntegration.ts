import * as vscode from "vscode";
import * as path from "node:path";
import {
  antigravityMcpPath,
  claudeProjectMcpPath,
  cursorMcpPath,
  npxServer,
  removeClaudeHooks,
  removeMcpServer,
  stripBlock,
  upsertMcpServer,
  writeClaudeHooks,
  writeCursorRule,
  writeRulesMarkdown,
} from "./hostConfig";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type Host = "vscode" | "cursor" | "antigravity" | "unknown";

/** Identify the running editor from its product name. */
export function detectHost(): Host {
  const name = (vscode.env.appName || "").toLowerCase();
  if (name.includes("cursor")) return "cursor";
  if (name.includes("antigravity")) return "antigravity";
  if (name.includes("code")) return "vscode"; // "Visual Studio Code", "Code - OSS"
  return "unknown";
}

export function hostLabel(host: Host): string {
  return { vscode: "VS Code", cursor: "Cursor", antigravity: "Antigravity", unknown: "this editor" }[host];
}

export interface AutonomyContext {
  host: Host;
  node: string;
  serverEntry: string;
  env: Record<string, string>;
  workspaceRoots: string[];
}

export interface AutonomyReport {
  lines: string[];
  needsReload: boolean;
}

/** Try Cursor's in-memory MCP registration API (no file write). */
function registerCursorApi(node: string, serverEntry: string, env: Record<string, string>): boolean {
  const cursor = (vscode as unknown as { cursor?: { mcp?: { registerServer?: Function } } }).cursor;
  if (cursor?.mcp?.registerServer) {
    cursor.mcp.registerServer({ name: "uace", server: { command: node, args: [serverEntry], env } });
    return true;
  }
  return false;
}

/**
 * Register the MCP server for the current host + write rules/hooks so any AI tool
 * recalls context at session start and saves at the end. Idempotent. Returns a
 * human-readable report. All file writes are non-destructive merges.
 */
export function setupAutonomy(ctx: AutonomyContext): AutonomyReport {
  const lines: string[] = [];
  let needsReload = false;
  const server = npxServer(ctx.env);

  // --- MCP registration (current host) ---
  switch (ctx.host) {
    case "vscode":
      lines.push("MCP: registered with VS Code (Copilot) provider.");
      break;
    case "cursor":
      if (registerCursorApi(ctx.node, ctx.serverEntry, ctx.env)) {
        lines.push("MCP: registered via Cursor API (no restart needed).");
      } else {
        upsertMcpServer(cursorMcpPath(), server);
        lines.push(`MCP: merged into ${cursorMcpPath()} — reload Cursor to connect.`);
        needsReload = true;
      }
      break;
    case "antigravity": {
      const p = antigravityMcpPath();
      upsertMcpServer(p, server);
      lines.push(`MCP: merged into ${p} — reload Antigravity to connect.`);
      needsReload = true;
      break;
    }
    default:
      lines.push("MCP: unknown host — relying on AGENTS.md + Copy MCP Config.");
  }

  // --- Per-workspace: Claude Code .mcp.json + rules + hooks ---
  for (const root of ctx.workspaceRoots) {
    const project = path.basename(root);
    // Claude Code project-scoped server (works whenever `claude` runs in this folder).
    upsertMcpServer(claudeProjectMcpPath(root), server);
    // Canonical cross-tool rules + host-native rules.
    writeRulesMarkdown(path.join(root, "AGENTS.md"));
    writeRulesMarkdown(path.join(root, ".github", "copilot-instructions.md"));
    writeCursorRule(root);
    // Claude Code hooks (passive recall + save).
    writeClaudeHooks(root, project);
  }
  if (ctx.workspaceRoots.length) {
    lines.push("Rules: wrote AGENTS.md, .cursor/rules/uace.mdc, .github/copilot-instructions.md.");
    lines.push("Claude Code: wrote .mcp.json + SessionStart/SessionEnd hooks (.claude/).");
  }

  return { lines, needsReload };
}

/** Undo setupAutonomy: remove UACE entries/blocks/hooks, leaving user content intact. */
export function removeAutonomy(ctx: Pick<AutonomyContext, "host" | "workspaceRoots">): string[] {
  const lines: string[] = [];
  if (ctx.host === "cursor") {
    if (removeMcpServer(cursorMcpPath())) lines.push(`Removed uace from ${cursorMcpPath()}.`);
  } else if (ctx.host === "antigravity") {
    if (removeMcpServer(antigravityMcpPath())) lines.push(`Removed uace from ${antigravityMcpPath()}.`);
  }
  for (const root of ctx.workspaceRoots) {
    removeMcpServer(claudeProjectMcpPath(root));
    removeClaudeHooks(root);
    for (const rel of ["AGENTS.md", path.join(".github", "copilot-instructions.md")]) {
      const file = path.join(root, rel);
      if (existsSync(file)) {
        const cleaned = stripBlock(readFileSync(file, "utf8"));
        writeFileSync(file, cleaned);
      }
    }
  }
  lines.push("Removed UACE rules blocks, .mcp.json entry, and Claude hooks.");
  return lines;
}
