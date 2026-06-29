import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export interface ScanResult {
  project: string;
  languages: string[];
  frameworks: string[];
  structure: string[]; // top-level directories
  readme: string | null; // short excerpt
}

/** A long-term memory derived from a scan, ready for `MemoryStore.saveMemory`. */
export interface ScanMemory {
  layer: "long-term";
  key: string;
  content: string;
  tags: string[];
}

/**
 * Turn a scan into the long-term memories it implies. Shared by the MCP
 * `scan_project` tool and the `uace-mcp sync` CLI so both ingest identically.
 */
export function scanToMemories(scan: ScanResult): ScanMemory[] {
  const out: ScanMemory[] = [];
  if (scan.languages.length)
    out.push({ layer: "long-term", key: "languages", content: `Languages/ecosystems: ${scan.languages.join(", ")}.`, tags: ["scan"] });
  if (scan.frameworks.length)
    out.push({ layer: "long-term", key: "frameworks", content: `Frameworks: ${scan.frameworks.join(", ")}.`, tags: ["scan"] });
  if (scan.structure.length)
    out.push({ layer: "long-term", key: "structure", content: `Top-level directories: ${scan.structure.join(", ")}.`, tags: ["scan"] });
  if (scan.readme)
    out.push({ layer: "long-term", key: "readme", content: `README excerpt: ${scan.readme}`, tags: ["scan"] });
  return out;
}

/** Manifest file -> ecosystem/language it implies. */
const MANIFEST_LANGUAGES: Record<string, string> = {
  "package.json": "JavaScript/Node",
  "tsconfig.json": "TypeScript",
  "requirements.txt": "Python",
  "pyproject.toml": "Python",
  "setup.py": "Python",
  "Pipfile": "Python",
  "go.mod": "Go",
  "Cargo.toml": "Rust",
  "pom.xml": "Java",
  "build.gradle": "Java",
  Gemfile: "Ruby",
  "composer.json": "PHP",
};

/** npm dependency name -> framework label. */
const NPM_FRAMEWORKS: Record<string, string> = {
  next: "Next.js",
  "react-scripts": "Create React App",
  react: "React",
  vue: "Vue",
  "@angular/core": "Angular",
  svelte: "Svelte",
  "@nestjs/core": "NestJS",
  express: "Express",
  fastify: "Fastify",
  electron: "Electron",
  "@modelcontextprotocol/sdk": "MCP",
};

/** substring in a Python manifest -> framework label. */
const PY_FRAMEWORKS: Record<string, string> = {
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
};

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan a project directory (shallow) and infer its languages, frameworks,
 * top-level structure, and a README excerpt. Intentionally lightweight: reads
 * manifest files and the top-level listing rather than walking the whole tree.
 */
export async function scanProject(path: string, projectName?: string): Promise<ScanResult> {
  const project = projectName ?? basename(path.replace(/\/+$/, ""));
  const languages = new Set<string>();
  const frameworks = new Set<string>();

  let entries: { name: string; isDir: boolean }[] = [];
  try {
    const dirents = await readdir(path, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch (err) {
    throw new Error(`Cannot scan "${path}": ${(err as Error).message}`);
  }

  const fileNames = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));

  // Languages from manifest files present at the root.
  for (const [manifest, lang] of Object.entries(MANIFEST_LANGUAGES)) {
    if (fileNames.has(manifest)) languages.add(lang);
  }

  // Frameworks from package.json dependencies.
  if (fileNames.has("package.json")) {
    try {
      const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, label] of Object.entries(NPM_FRAMEWORKS)) {
        if (deps[dep]) frameworks.add(label);
      }
    } catch {
      /* malformed package.json — skip framework detection */
    }
  }

  // Frameworks from Python manifests (text scan).
  for (const manifest of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    if (!fileNames.has(manifest)) continue;
    try {
      const text = (await readFile(join(path, manifest), "utf8")).toLowerCase();
      for (const [needle, label] of Object.entries(PY_FRAMEWORKS)) {
        if (text.includes(needle)) frameworks.add(label);
      }
    } catch {
      /* skip */
    }
  }

  // Top-level structure (directories, minus noise).
  const structure = entries
    .filter((e) => e.isDir && !IGNORE_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  // README excerpt.
  let readme: string | null = null;
  for (const name of ["README.md", "readme.md", "README", "Readme.md"]) {
    if (await exists(join(path, name))) {
      const raw = await readFile(join(path, name), "utf8");
      readme = raw.replace(/\s+/g, " ").trim().slice(0, 600);
      break;
    }
  }

  return {
    project,
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    structure,
    readme,
  };
}
