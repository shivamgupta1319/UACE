import * as vscode from "vscode";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync } from "node:child_process";

export interface Runtime {
  node: string;
  /** Path to npm-cli.js (run via `node npm-cli.js …`), or null if not found. */
  npmCli: string | null;
}

const isWin = platform() === "win32";
const nodeBin = isWin ? "node.exe" : "node";

/**
 * Resolve a usable Node binary. GUI-launched editors often lack nvm/fnm/asdf on
 * PATH, so we check the setting, then PATH, then common version-manager and
 * system locations.
 */
export function resolveNode(): string | null {
  const configured = vscode.workspace.getConfiguration("uace").get<string>("nodePath")?.trim();
  if (configured && existsSync(configured)) return configured;

  const onPath = whichNode();
  if (onPath) return onPath;

  for (const candidate of candidateNodePaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve Node plus the npm CLI that ships alongside it. */
export function resolveRuntime(): Runtime | null {
  const node = resolveNode();
  if (!node) return null;
  return { node, npmCli: findNpmCli(node) };
}

function whichNode(): string | null {
  try {
    const cmd = isWin ? "where" : "which";
    const out = execFileSync(cmd, ["node"], { encoding: "utf8" }).split(/\r?\n/)[0]?.trim();
    return out && existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/** Newest-first list of likely Node binaries from version managers / system dirs. */
function candidateNodePaths(): string[] {
  const home = homedir();
  const out: string[] = [];

  // nvm: ~/.nvm/versions/node/<ver>/bin/node  (prefer newest version)
  out.push(...versionedBins(join(home, ".nvm", "versions", "node"), ["bin", nodeBin]));
  // fnm: ~/.fnm/node-versions/<ver>/installation/bin/node
  out.push(...versionedBins(join(home, ".fnm", "node-versions"), ["installation", "bin", nodeBin]));
  // asdf: ~/.asdf/installs/nodejs/<ver>/bin/node
  out.push(...versionedBins(join(home, ".asdf", "installs", "nodejs"), ["bin", nodeBin]));
  // volta
  out.push(join(home, ".volta", "bin", nodeBin));

  // system locations
  for (const dir of ["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin", "/opt/local/bin"]) {
    out.push(join(dir, nodeBin));
  }
  if (isWin) {
    out.push("C:\\Program Files\\nodejs\\node.exe");
  }
  return out;
}

/** List <root>/<version>/<...suffix> sorted newest-version first. */
function versionedBins(root: string, suffix: string[]): string[] {
  try {
    return readdirSync(root)
      .sort(compareVersionsDesc)
      .map((v) => join(root, v, ...suffix));
  } catch {
    return [];
  }
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** npm-cli.js lives near the node binary; check the known layouts. */
function findNpmCli(node: string): string | null {
  const binDir = dirname(node);
  const candidates = [
    join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // nvm / system unix
    join(binDir, "node_modules", "npm", "bin", "npm-cli.js"), // windows
    join(binDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}
