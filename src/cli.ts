import { homedir } from "node:os";
import { basename, join } from "node:path";
import { openDb, tryEnableVectors } from "./db.js";
import { MemoryStore } from "./memory.js";
import { createEmbedder } from "./embedder.js";
import { scanProject, scanToMemories } from "./scanner.js";
import { readRecentCommits } from "./git.js";
import { importClaudeSessions, parseTranscript } from "./transcripts.js";

/**
 * One-shot CLI mode for the UACE server binary, so external processes (Claude
 * Code hooks, scripts) can read/write the shared brain WITHOUT speaking MCP.
 *
 *   uace-mcp context <project> [--query q] [--limit n]
 *   uace-mcp save-session --project p (--from-transcript path | --summary s [--next s])
 *   uace-mcp sync <path> [--project p]
 *
 * stdout is RESERVED for the command payload (the Claude Code SessionStart hook
 * injects stdout into the model's context, so any stray noise would corrupt it).
 * All logs/diagnostics go to stderr.
 */
export const CLI_SUBCOMMANDS = new Set(["context", "save-session", "sync"]);

type Flags = { _: string[] } & Record<string, string | boolean | string[]>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/** stdout = payload only. */
function out(s: string): void {
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}
/** stderr = logs/diagnostics. */
function log(s: string): void {
  process.stderr.write(s + "\n");
}

function makeStore(needEmbeddings: boolean): MemoryStore {
  const dbPath = process.env.UACE_DB ?? join(homedir(), ".uace", "memory.db");
  const db = openDb(dbPath);
  // Embeddings are LAZY (model loads on first use), but skipping the embedder on
  // the hot `context` path keeps it strictly FTS/recency — fast enough for the
  // Claude Code SessionStart timeout and Cursor's short MCP startup window.
  const embedder = needEmbeddings ? createEmbedder() : null;
  const vectorsEnabled = embedder ? tryEnableVectors(db, embedder.dim) : false;
  return new MemoryStore(db, { embedder, vectorsEnabled });
}

/** Run a CLI subcommand. Returns a process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));
  switch (sub) {
    case "context":
      return cmdContext(flags);
    case "save-session":
      return cmdSaveSession(flags);
    case "sync":
      return cmdSync(flags);
    default:
      log(`Unknown command: ${sub ?? "(none)"}. Expected: context | save-session | sync.`);
      return 2;
  }
}

async function cmdContext(flags: Flags): Promise<number> {
  const project = flags._[0] ?? str(flags, "project");
  if (!project) {
    log("usage: uace-mcp context <project> [--query <q>] [--limit <n>]");
    return 2;
  }
  // No-embed by default. A real --query (semantic focus) is the only thing that
  // may load the model — opt-in, never on the default recall path.
  const query = str(flags, "query");
  const limit = Number(str(flags, "limit") ?? 50) || 50;
  const store = makeStore(Boolean(query));
  const packet = await store.buildContextPacket(project, limit, query);
  out(packet);
  return 0;
}

async function cmdSaveSession(flags: Flags): Promise<number> {
  const project = str(flags, "project") ?? flags._[0];
  if (!project) {
    log("usage: uace-mcp save-session --project <p> (--from-transcript <path> | --summary <s> [--next <s>])");
    return 2;
  }
  const store = makeStore(false);

  const fromTranscript = str(flags, "from-transcript");
  if (fromTranscript) {
    const externalId = basename(fromTranscript).replace(/\.jsonl$/, "");
    const parsed = await parseTranscript(fromTranscript, externalId);
    if (!parsed) {
      log(`No usable content in transcript ${fromTranscript}.`);
      return 1;
    }
    const { row, created } = store.saveSession({
      project,
      title: parsed.title,
      summary: parsed.summary,
      prompt: parsed.prompt,
      files: parsed.files,
      source: parsed.source,
      externalId: parsed.externalId,
    });
    log(created ? `Saved session #${row.id} for "${project}".` : `Session already known (#${row.id}).`);
    return 0;
  }

  const summary = str(flags, "summary");
  if (!summary) {
    log("save-session needs --from-transcript <path> or --summary <text>.");
    return 2;
  }
  const { row } = store.saveSession({ project, summary, nextSteps: str(flags, "next") });
  log(`Saved session #${row.id} for "${project}".`);
  return 0;
}

async function cmdSync(flags: Flags): Promise<number> {
  const path = flags._[0] ?? str(flags, "path");
  if (!path) {
    log("usage: uace-mcp sync <path> [--project <p>]");
    return 2;
  }
  const project = str(flags, "project") ?? basename(path.replace(/\/+$/, ""));
  const store = makeStore(true); // scan writes long-term memories (embedded for search)

  const scan = await scanProject(path, project);
  for (const mem of scanToMemories(scan)) {
    await store.saveMemory({ project, ...mem });
  }

  const commits = await readRecentCommits(path);
  const addedCommits = commits.length ? store.saveCommits(project, commits) : 0;

  const sessions = await importClaudeSessions(path, { maxSessions: 10 });
  let newSessions = 0;
  for (const s of sessions) {
    const { created } = store.saveSession({
      project,
      title: s.title,
      summary: s.summary,
      prompt: s.prompt,
      files: s.files,
      source: s.source,
      externalId: s.externalId,
    });
    if (created) newSessions++;
  }

  log(
    `Synced "${project}": ${scan.languages.length} langs / ${scan.frameworks.length} frameworks, ` +
      `${addedCommits} new commits, ${newSessions} new sessions.`
  );
  return 0;
}
