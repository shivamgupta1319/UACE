import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Runtime } from "./nodeResolver";

const execFileAsync = promisify(execFile);

export const SERVER_PACKAGE = "uace-mcp";
export const SERVER_VERSION = "0.1.1";

/**
 * Ensure the UACE MCP server is available and return the path to its entry.
 *
 * Order of resolution:
 *  1. `uace.serverPath` setting (override; used for local development).
 *  2. A copy installed under the extension's global storage (installed on first
 *     run via the user's own npm, which fetches the right native binaries).
 *
 * `packageSpec` is overridable for testing (e.g. a local .tgz).
 */
export async function ensureServer(
  context: vscode.ExtensionContext,
  runtime: Runtime,
  packageSpec = `${SERVER_PACKAGE}@${SERVER_VERSION}`
): Promise<string> {
  const override = vscode.workspace.getConfiguration("uace").get<string>("serverPath")?.trim();
  if (override && existsSync(override)) return override;

  const root = context.globalStorageUri.fsPath;
  const serverEntry = join(root, "node_modules", SERVER_PACKAGE, "dist", "server.js");

  if (existsSync(serverEntry) && installedVersion(root) === SERVER_VERSION) {
    return serverEntry;
  }

  await installServer(root, runtime, packageSpec);

  if (!existsSync(serverEntry)) {
    throw new Error(`UACE server install completed but ${serverEntry} is missing.`);
  }
  return serverEntry;
}

function installedVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", SERVER_PACKAGE, "package.json"), "utf8")
    );
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function installServer(root: string, runtime: Runtime, packageSpec: string): Promise<void> {
  if (!runtime.npmCli) {
    throw new Error(
      "Could not locate npm to install the UACE server. Install Node.js, or set 'uace.serverPath' to a built dist/server.js."
    );
  }
  mkdirSync(root, { recursive: true });
  // A local package.json keeps npm from walking up to a parent project.
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) {
    writeFileSync(manifest, JSON.stringify({ name: "uace-engine-host", private: true }, null, 2));
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "UACE: installing the memory engine (one-time setup)…",
      cancellable: false,
    },
    async () => {
      await execFileAsync(
        runtime.node,
        [runtime.npmCli!, "install", packageSpec, "--prefix", root, "--no-audit", "--no-fund", "--loglevel=error"],
        { cwd: root, maxBuffer: 1024 * 1024 * 64, timeout: 10 * 60 * 1000 }
      );
    }
  );
}
