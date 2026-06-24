import * as vscode from "vscode";
import { SERVER_VERSION } from "./serverBootstrap";

/**
 * Registers the UACE server with VS Code's native MCP system so the Copilot
 * agent discovers the tools with no user configuration.
 *
 * The API (`vscode.lm.registerMcpServerDefinitionProvider` + the
 * `McpStdioServerDefinition` class) was finalized in VS Code 1.101. We access it
 * defensively so the extension still loads (dashboard only) on older builds.
 */
export class UaceMcpProvider {
  static readonly id = "uace";
  private readonly changed = new vscode.EventEmitter<void>();
  private definition: unknown | null = null;

  /** Returns true if the native MCP API was available and we registered. */
  register(context: vscode.ExtensionContext): boolean {
    const lm = (vscode as unknown as { lm?: any }).lm;
    if (!lm || typeof lm.registerMcpServerDefinitionProvider !== "function") {
      return false;
    }
    const disposable = lm.registerMcpServerDefinitionProvider(UaceMcpProvider.id, {
      onDidChangeMcpServerDefinitions: this.changed.event,
      provideMcpServerDefinitions: async () => (this.definition ? [this.definition] : []),
      resolveMcpServerDefinition: async (server: unknown) => server,
    });
    context.subscriptions.push(disposable, this.changed);
    return true;
  }

  /** Point the registered server at the resolved node + server entry. */
  setServer(node: string, serverPath: string, env: Record<string, string>): void {
    const StdioDef = (vscode as unknown as { McpStdioServerDefinition?: any })
      .McpStdioServerDefinition;
    if (!StdioDef) return;
    this.definition = new StdioDef("UACE Memory", node, [serverPath], env, SERVER_VERSION);
    this.changed.fire();
  }
}
