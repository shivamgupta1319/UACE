import * as vscode from "vscode";
import * as path from "node:path";
import { UaceClient, DashboardData, ProjectSummary } from "./uaceClient";
import { resolveRuntime, Runtime } from "./nodeResolver";
import { ensureServer } from "./serverBootstrap";
import { UaceMcpProvider } from "./mcpProvider";

/** Discriminated tree nodes. */
type Node =
  | { kind: "message"; label: string }
  | { kind: "project"; project: string; description: string }
  | { kind: "category"; project: string; category: Category; label: string }
  | { kind: "leaf"; label: string; description?: string; tooltip?: string };

type Category = "working" | "long-term" | "session" | "sessions" | "files" | "commits";

/** Resolved runtime + server entry, populated by init() once bootstrap finishes. */
let runtime: Runtime | null = null;
let serverEntry: string | null = null;
let startupMessage = "UACE is starting…";

function makeClient(): UaceClient | null {
  if (!runtime || !serverEntry) return null;
  const dbPath = vscode.workspace.getConfiguration("uace").get<string>("dbPath")?.trim() || undefined;
  return new UaceClient(serverEntry, dbPath, runtime.node);
}

class BrainProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private client: UaceClient | null = null;
  private built = false;
  private cache = new Map<string, DashboardData>();

  private ensureClient(): UaceClient | null {
    if (!this.built) {
      this.client = makeClient();
      this.built = true;
    }
    return this.client;
  }

  /** Soft refresh: re-fetch data but keep the server process (and its file
   *  watcher) alive. */
  refresh(): void {
    this.cache.clear();
    this._onDidChange.fire(undefined);
  }

  /** Hard reconnect: tear down the server and rebuild the client (config/runtime change). */
  reconnect(): void {
    this.cache.clear();
    this.client?.dispose();
    this.client = null;
    this.built = false;
    this._onDidChange.fire(undefined);
  }

  getClient(): UaceClient | null {
    return this.ensureClient();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "message": {
        const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        i.iconPath = new vscode.ThemeIcon("info");
        return i;
      }
      case "project": {
        const i = new vscode.TreeItem(node.project, vscode.TreeItemCollapsibleState.Collapsed);
        i.description = node.description;
        i.iconPath = new vscode.ThemeIcon("database");
        i.contextValue = "uaceProject";
        return i;
      }
      case "category": {
        const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        i.iconPath = new vscode.ThemeIcon(CATEGORY_ICON[node.category]);
        return i;
      }
      case "leaf": {
        const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        i.description = node.description;
        i.tooltip = node.tooltip ?? node.label;
        return i;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const client = this.ensureClient();
    if (!client) {
      return [{ kind: "message", label: startupMessage }];
    }
    try {
      if (!node) return await this.rootProjects(client);
      if (node.kind === "project") return this.categories(node.project);
      if (node.kind === "category") return await this.categoryItems(node.project, node.category);
      return [];
    } catch (err) {
      return [{ kind: "message", label: `UACE error: ${(err as Error).message}` }];
    }
  }

  private async rootProjects(client: UaceClient): Promise<Node[]> {
    const projects: ProjectSummary[] = await client.listProjects();
    if (!projects.length) return [{ kind: "message", label: "No projects yet. Open a project folder and it will sync automatically." }];
    return projects.map((p) => ({
      kind: "project" as const,
      project: p.name,
      description: `${p.memories} memories · ${p.sessions} sessions`,
    }));
  }

  private async load(project: string): Promise<DashboardData> {
    let d = this.cache.get(project);
    if (!d) {
      d = await this.client!.getDashboard(project);
      this.cache.set(project, d);
    }
    return d;
  }

  private async categories(project: string): Promise<Node[]> {
    const d = await this.load(project);
    const cat = (category: Category, label: string, n: number): Node => ({
      kind: "category",
      project,
      category,
      label: `${label} (${n})`,
    });
    const out: Node[] = [];
    if (d.memories.working.length) out.push(cat("working", "Working Memory", d.memories.working.length));
    if (d.memories["long-term"].length) out.push(cat("long-term", "Long-Term Memory", d.memories["long-term"].length));
    if (d.memories.session.length) out.push(cat("session", "Session Memory", d.memories.session.length));
    if (d.sessions.length) out.push(cat("sessions", "Recent Sessions", d.sessions.length));
    if (d.activeFiles.length) out.push(cat("files", "Active Files", d.activeFiles.length));
    if (d.commits.length) out.push(cat("commits", "Recent Commits", d.commits.length));
    if (!out.length) out.push({ kind: "message", label: "(empty)" });
    return out;
  }

  private async categoryItems(project: string, category: Category): Promise<Node[]> {
    const d = await this.load(project);
    if (category === "working" || category === "long-term" || category === "session") {
      return d.memories[category].map((m) => ({
        kind: "leaf",
        label: m.key ?? m.content.slice(0, 40),
        description: m.key ? m.content.slice(0, 60) : undefined,
        tooltip: m.content,
      }));
    }
    if (category === "sessions") {
      return d.sessions.map((s) => ({
        kind: "leaf",
        label: s.title ?? s.summary.slice(0, 50),
        description: s.created_at?.slice(0, 10),
        tooltip: `${s.summary}${s.next_steps ? `\n\nNext: ${s.next_steps}` : ""}`,
      }));
    }
    if (category === "files") {
      return d.activeFiles.map((f) => ({
        kind: "leaf",
        label: f.path,
        description: f.event,
      }));
    }
    return d.commits.map((c) => ({
      kind: "leaf",
      label: c.message.slice(0, 60),
      description: `${c.hash.slice(0, 7)} ${c.date?.slice(0, 10) ?? ""}`,
    }));
  }
}

async function pickProject(client: UaceClient): Promise<string | undefined> {
  const projects = await client.listProjects();
  if (!projects.length) {
    vscode.window.showInformationMessage("UACE: no projects found yet.");
    return undefined;
  }
  if (projects.length === 1) return projects[0].name;
  return vscode.window.showQuickPick(
    projects.map((p) => p.name),
    { placeHolder: "Select a project" }
  );
}

/** Local filesystem workspace folders only. */
function localFolders(): vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
}

/**
 * Auto-onboard each open workspace folder: scan it, import its Claude Code
 * sessions, and start watching it for live file changes. Idempotent — safe to
 * re-run on every activation / workspace change. The project id is the folder
 * name, so naming stays consistent across tools.
 */
async function autoSync(provider: BrainProvider, manual = false): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("uace");
  if (!manual && !cfg.get<boolean>("autoSync", true)) return;

  const client = provider.getClient();
  if (!client) {
    if (manual) vscode.window.showWarningMessage(`UACE: not ready — ${startupMessage}`);
    return;
  }
  const folders = localFolders();
  if (!folders.length) {
    if (manual) vscode.window.showInformationMessage("UACE: no workspace folder open to sync.");
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "UACE: syncing project…" },
    async () => {
      for (const folder of folders) {
        const fsPath = folder.uri.fsPath;
        const project = path.basename(fsPath);
        try {
          await client.scanProject(fsPath, project);
          await client.importSessions(fsPath, project);
          await client.watchProject(fsPath, project);
        } catch (err) {
          vscode.window.showErrorMessage(`UACE: sync failed for ${project}: ${(err as Error).message}`);
        }
      }
    }
  );
  provider.refresh();
}

/** Environment passed to the server (only UACE_DB override, if set). */
function serverEnv(): Record<string, string> {
  const db = vscode.workspace.getConfiguration("uace").get<string>("dbPath")?.trim();
  return db ? { UACE_DB: db } : {};
}

/**
 * Resolve Node, install/locate the server, register it with VS Code's MCP, then
 * connect the dashboard. Re-runnable on settings change.
 */
async function init(
  context: vscode.ExtensionContext,
  provider: BrainProvider,
  mcp: UaceMcpProvider
): Promise<void> {
  runtime = resolveRuntime();
  if (!runtime) {
    startupMessage = "Node.js not found. Install Node, or set 'uace.nodePath' in Settings.";
    serverEntry = null;
    provider.reconnect();
    vscode.window.showWarningMessage(
      "UACE: couldn't find Node.js. Set 'uace.nodePath' to your Node binary in Settings."
    );
    return;
  }
  try {
    serverEntry = await ensureServer(context, runtime);
  } catch (err) {
    startupMessage = `UACE setup failed: ${(err as Error).message}`;
    serverEntry = null;
    provider.reconnect();
    vscode.window.showErrorMessage(startupMessage);
    return;
  }

  // Hand the server to VS Code's Copilot agent (zero-config), then connect the UI.
  mcp.setServer(runtime.node, serverEntry, serverEnv());
  provider.reconnect();
  await autoSync(provider);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new BrainProvider();
  const mcp = new UaceMcpProvider();
  mcp.register(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("uaceMemory", provider),
    vscode.commands.registerCommand("uace.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("uace.syncNow", () => autoSync(provider, true)),
    vscode.commands.registerCommand("uace.copyMcpConfig", () => copyMcpConfig()),

    vscode.workspace.onDidChangeWorkspaceFolders(() => autoSync(provider)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("uace")) void init(context, provider, mcp);
    }),

    vscode.commands.registerCommand("uace.continueSession", async () => {
      const client = provider.getClient();
      if (!client) {
        vscode.window.showWarningMessage(`UACE: not ready — ${startupMessage}`);
        return;
      }
      const project = await pickProject(client);
      if (!project) return;
      const packet = await client.getContext(project);
      const doc = await vscode.workspace.openTextDocument({ content: packet, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand("uace.saveSession", async () => {
      const client = provider.getClient();
      if (!client) {
        vscode.window.showWarningMessage(`UACE: not ready — ${startupMessage}`);
        return;
      }
      const project = await pickProject(client);
      if (!project) return;
      const summary = await vscode.window.showInputBox({
        prompt: `Session summary for "${project}"`,
        placeHolder: "What did you accomplish this session?",
      });
      if (!summary) return;
      const nextSteps = await vscode.window.showInputBox({ prompt: "Next steps (optional)" });
      await client.saveSession({ project, summary, nextSteps: nextSteps || undefined, source: "vscode" });
      vscode.window.showInformationMessage(`UACE: saved session for ${project}.`);
      provider.refresh();
    })
  );

  // Resolve Node, install/locate the server, register MCP, and sync — in the background.
  void init(context, provider, mcp);
}

/** Generate ready-to-paste MCP config for Claude Code and Cursor. */
async function copyMcpConfig(): Promise<void> {
  if (!runtime || !serverEntry) {
    vscode.window.showWarningMessage(`UACE: not ready yet — ${startupMessage}`);
    return;
  }
  const node = runtime.node;
  const server = serverEntry;
  // Portable config (works on any machine — no local paths).
  const claudeNpx = `claude mcp add uace --scope user -- npx -y uace-mcp`;
  const cursorNpx = JSON.stringify(
    { mcpServers: { uace: { command: "npx", args: ["-y", "uace-mcp"] } } },
    null,
    2
  );
  // Fallback for environments where `npx` isn't on PATH (e.g. GUI apps + nvm).
  const claudeAbs = `claude mcp add uace --scope user -- "${node}" "${server}"`;
  const cursorAbs = JSON.stringify(
    { mcpServers: { uace: { command: node, args: [server] } } },
    null,
    2
  );
  const doc = `# Connect UACE to other AI tools

\`uace-mcp\` is on npm, so any MCP-capable tool can share this project memory with **no local paths**. All tools read/write the same database (\`~/.uace/memory.db\`).

## Claude Code (recommended)

\`\`\`bash
${claudeNpx}
\`\`\`

## Cursor (recommended) — add to \`~/.cursor/mcp.json\`

\`\`\`json
${cursorNpx}
\`\`\`

Reload the tool afterward.

---

### If \`npx\` isn't found (some GUI apps don't inherit nvm/fnm PATH)

Use absolute paths to *this* machine's Node + engine instead:

\`\`\`bash
${claudeAbs}
\`\`\`

\`\`\`json
${cursorAbs}
\`\`\`
`;
  await vscode.env.clipboard.writeText(claudeNpx);
  const editor = await vscode.workspace.openTextDocument({ content: doc, language: "markdown" });
  await vscode.window.showTextDocument(editor, { preview: false });
  vscode.window.showInformationMessage("UACE: Claude Code command copied to clipboard.");
}

export function deactivate(): void {
  /* server processes exit with the extension host */
}

const CATEGORY_ICON: Record<Category, string> = {
  working: "tasklist",
  "long-term": "book",
  session: "comment-discussion",
  sessions: "history",
  files: "edit",
  commits: "git-commit",
};
