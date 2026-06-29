// The MCP SDK is ESM-only; this extension compiles to CommonJS. Using a
// Function-wrapped import() prevents TypeScript from down-leveling it to
// require() (which can't load ESM), giving us a real native dynamic import.
const dynamicImport = new Function("s", "return import(s)") as (
  s: string
) => Promise<any>;

export interface MemoryItem {
  id: number;
  layer: string;
  key: string | null;
  content: string;
  tags: string | null;
  updated_at: string;
}
export interface SessionItem {
  id: number;
  title: string | null;
  summary: string;
  next_steps: string | null;
  source: string | null;
  created_at: string;
}
export interface DashboardData {
  project: string;
  memories: { "long-term": MemoryItem[]; working: MemoryItem[]; session: MemoryItem[] };
  sessions: SessionItem[];
  activeFiles: { path: string; event: string; ts: string }[];
  commits: { hash: string; date: string | null; message: string }[];
}
export interface ProjectSummary {
  name: string;
  memories: number;
  sessions: number;
  lastActivity: string | null;
}

/**
 * Thin MCP client that spawns the UACE server (system `node`) over stdio and
 * exposes the dashboard tools as typed methods. Embeddings are disabled for the
 * dashboard's read-only traffic so it stays fast and offline.
 */
export class UaceClient {
  private client: any = null;
  private connecting: Promise<void> | null = null;

  constructor(
    private serverPath: string,
    private dbPath?: string,
    private nodePath?: string
  ) {}

  private async connect(): Promise<void> {
    if (this.client) return;
    if (!this.connecting) this.connecting = this.doConnect();
    try {
      await this.connecting;
    } catch (err) {
      this.connecting = null; // allow retry after fixing settings
      throw err;
    }
  }

  private async doConnect(): Promise<void> {
    const { Client } = await dynamicImport("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await dynamicImport(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const env: Record<string, string> = { UACE_NO_EMBED: "1" };
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (this.dbPath) env.UACE_DB = this.dbPath;

    const command = this.nodePath?.trim() || "node";
    const transport = new StdioClientTransport({
      command,
      args: [this.serverPath],
      env,
      stderr: "pipe",
    });

    // Capture server stderr so startup crashes surface a real message.
    let stderr = "";
    try {
      transport.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
    } catch {
      /* stderr stream not available; continue */
    }

    const client = new Client({ name: "uace-dashboard", version: "0.1.0" });
    try {
      await client.connect(transport);
    } catch (err) {
      const detail = stderr.trim();
      const hint =
        `Failed to start the UACE server with '${command}'. ` +
        (detail
          ? `Server output:\n${detail}`
          : `The process exited immediately. If Node is installed via nvm/asdf, set 'uace.nodePath' to its absolute path.`);
      throw new Error(hint);
    }
    this.client = client;
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    await this.connect();
    const res = await this.client.callTool({ name, arguments: args });
    return res?.content?.[0]?.text ?? "";
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return JSON.parse(await this.call("list_projects"));
  }
  async getDashboard(project: string): Promise<DashboardData> {
    return JSON.parse(await this.call("get_dashboard", { project }));
  }
  async getContext(project: string, query?: string): Promise<string> {
    return this.call("get_project_context", query ? { project, query } : { project });
  }
  async saveSession(args: {
    project: string;
    summary: string;
    nextSteps?: string;
    source?: string;
  }): Promise<string> {
    return this.call("save_session", args);
  }

  async deleteMemory(id: number): Promise<string> {
    return this.call("delete_memory", { id });
  }
  async deleteSession(id: number): Promise<string> {
    return this.call("delete_session", { id });
  }
  async deleteProject(project: string): Promise<string> {
    return this.call("delete_project", { project });
  }

  // --- auto-onboard the open workspace ---
  async scanProject(path: string, project: string): Promise<string> {
    return this.call("scan_project", { path, project });
  }
  async importSessions(path: string, project: string): Promise<string> {
    return this.call("import_claude_sessions", { path, project });
  }
  async watchProject(path: string, project: string): Promise<string> {
    return this.call("watch_project", { path, project });
  }

  async dispose(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.connecting = null;
  }
}
