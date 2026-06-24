import * as vscode from "vscode";
import { UaceClient, DashboardData, ProjectSummary } from "./uaceClient";

/** Discriminated tree nodes. */
type Node =
  | { kind: "message"; label: string }
  | { kind: "project"; project: string; description: string }
  | { kind: "category"; project: string; category: Category; label: string }
  | { kind: "leaf"; label: string; description?: string; tooltip?: string };

type Category = "working" | "long-term" | "session" | "sessions" | "files" | "commits";

function getClient(): UaceClient | null {
  const cfg = vscode.workspace.getConfiguration("uace");
  const serverPath = cfg.get<string>("serverPath")?.trim();
  if (!serverPath) return null;
  const dbPath = cfg.get<string>("dbPath")?.trim() || undefined;
  const nodePath = cfg.get<string>("nodePath")?.trim() || undefined;
  return new UaceClient(serverPath, dbPath, nodePath);
}

class BrainProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private client: UaceClient | null;
  private cache = new Map<string, DashboardData>();

  constructor() {
    this.client = getClient();
  }

  refresh(): void {
    this.cache.clear();
    this.client?.dispose();
    this.client = getClient();
    this._onDidChange.fire(undefined);
  }

  getClient(): UaceClient | null {
    return this.client;
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
    if (!this.client) {
      return [{ kind: "message", label: "Set 'uace.serverPath' in Settings to connect." }];
    }
    try {
      if (!node) return await this.rootProjects();
      if (node.kind === "project") return this.categories(node.project);
      if (node.kind === "category") return await this.categoryItems(node.project, node.category);
      return [];
    } catch (err) {
      return [{ kind: "message", label: `UACE error: ${(err as Error).message}` }];
    }
  }

  private async rootProjects(): Promise<Node[]> {
    const projects: ProjectSummary[] = await this.client!.listProjects();
    if (!projects.length) return [{ kind: "message", label: "No projects yet. Use the MCP tools to add memory." }];
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

export function activate(context: vscode.ExtensionContext): void {
  const provider = new BrainProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("uaceMemory", provider),
    vscode.commands.registerCommand("uace.refresh", () => provider.refresh()),

    vscode.commands.registerCommand("uace.continueSession", async () => {
      const client = provider.getClient();
      if (!client) {
        vscode.window.showWarningMessage("UACE: set 'uace.serverPath' in Settings first.");
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
        vscode.window.showWarningMessage("UACE: set 'uace.serverPath' in Settings first.");
        return;
      }
      const project = await pickProject(client);
      if (!project) return;
      const summary = await vscode.window.showInputBox({
        prompt: `Session summary for "${project}"`,
        placeHolder: "What did you accomplish this session?",
      });
      if (!summary) return;
      const nextSteps = await vscode.window.showInputBox({
        prompt: "Next steps (optional)",
      });
      await client.saveSession({ project, summary, nextSteps: nextSteps || undefined, source: "vscode" });
      vscode.window.showInformationMessage(`UACE: saved session for ${project}.`);
      provider.refresh();
    })
  );
}

export function deactivate(): void {
  /* client is disposed via provider refresh / process exit */
}

const CATEGORY_ICON: Record<Category, string> = {
  working: "tasklist",
  "long-term": "book",
  session: "comment-discussion",
  sessions: "history",
  files: "edit",
  commits: "git-commit",
};
