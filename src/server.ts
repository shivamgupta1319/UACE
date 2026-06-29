#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb, tryEnableVectors } from "./db.js";
import { MemoryStore } from "./memory.js";
import { createEmbedder } from "./embedder.js";
import { scanProject, scanToMemories } from "./scanner.js";
import { readRecentCommits } from "./git.js";
import { runCli, CLI_SUBCOMMANDS } from "./cli.js";
import { FileWatcher } from "./watcher.js";
import { importClaudeSessions } from "./transcripts.js";
import { basename } from "node:path";
import {
  saveMemorySchema,
  searchMemorySchema,
  getProjectContextSchema,
  saveSessionSchema,
  listSessionsSchema,
  scanProjectSchema,
  getRecentChangesSchema,
  reindexMemoriesSchema,
  watchProjectSchema,
  unwatchProjectSchema,
  getActiveFilesSchema,
  importClaudeSessionsSchema,
  listProjectsSchema,
  getDashboardSchema,
  deleteMemorySchema,
  deleteSessionSchema,
  deleteProjectSchema,
  pruneStaleSchema,
} from "./types.js";

// Guard the MCP stdio channel: any stray library writes to stdout would corrupt
// the JSON-RPC stream, so route console.log to stderr. (The transport writes to
// process.stdout directly and is unaffected.)
console.log = (...args: unknown[]) => console.error(...args);

/**
 * Universal AI Context Engine — MCP server (stdio).
 *
 * The database lives at a SHARED, user-global path by default so that every
 * MCP client (Claude Code, Cursor, …) reads and writes the same memory. Override
 * with UACE_DB to point at a per-machine or per-project store.
 */
const DB_PATH = process.env.UACE_DB ?? join(homedir(), ".uace", "memory.db");

// CLI mode: `uace-mcp <context|save-session|sync> …` runs a one-shot command and
// exits, reusing the same shared DB. Anything else (incl. no args) starts the MCP
// stdio server below. Top-level await guarantees the server bootstrap never runs
// in CLI mode. (Embeddings stay lazy, so the server consts cost nothing here.)
const cliSub = process.argv[2];
if (cliSub && CLI_SUBCOMMANDS.has(cliSub)) {
  process.exit(await runCli(process.argv.slice(2)));
}

const db = openDb(DB_PATH);
const embedder = createEmbedder();
const vectorsEnabled = embedder ? tryEnableVectors(db, embedder.dim) : false;
const store = new MemoryStore(db, { embedder, vectorsEnabled });
const watcher = new FileWatcher();

const server = new McpServer({
  name: "uace",
  version: "0.2.3",
});

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.registerTool(
  "get_project_context",
  {
    title: "Get Project Context",
    description:
      "Pull the saved context packet for a project (layered memory + recent git changes + last session). Call this at the START of a session so you don't have to re-explain the project. Pass `query` to also get a semantically-ranked 'Most Relevant' section.",
    inputSchema: getProjectContextSchema,
  },
  async ({ project, query, limit }) =>
    text(await store.buildContextPacket(project, limit, query))
);

server.registerTool(
  "save_memory",
  {
    title: "Save Memory",
    description:
      "Persist a durable fact/decision/standard for a project. Use layer=long-term for architecture/standards, working for current task/TODOs, session for transient notes. Provide a stable `key` to upsert.",
    inputSchema: saveMemorySchema,
  },
  async (args) => {
    const row = await store.saveMemory(args);
    return text(`Saved memory #${row.id} (${row.layer}${row.key ? `/${row.key}` : ""}).`);
  }
);

server.registerTool(
  "search_memory",
  {
    title: "Search Memory",
    description:
      "Search a project's memories by meaning (semantic vector search) when available, falling back to keyword search. Returns the most relevant entries.",
    inputSchema: searchMemorySchema,
  },
  async (args) => {
    const semantic = await store.semanticSearch(args);
    const rows = semantic && semantic.length ? semantic : store.searchMemory(args);
    const mode = semantic && semantic.length ? "semantic" : "keyword";
    if (!rows.length) return text(`No memories matched "${args.query}".`);
    const body = rows
      .map(
        (r) =>
          `- [${r.layer}${r.key ? `/${r.key}` : ""}] ${r.content}` +
          (r.tags ? `  (tags: ${r.tags})` : "")
      )
      .join("\n");
    return text(`(${mode} search)\n${body}`);
  }
);

server.registerTool(
  "save_session",
  {
    title: "Save Session",
    description:
      "Record a session summary so the next assistant (any tool) can continue. Include what was done, decisions, files touched, and next steps.",
    inputSchema: saveSessionSchema,
  },
  async (args) => {
    const { row } = store.saveSession(args);
    return text(`Saved session #${row.id} for ${row.project}.`);
  }
);

server.registerTool(
  "list_sessions",
  {
    title: "List Sessions",
    description: "List recent session summaries for a project (most recent first).",
    inputSchema: listSessionsSchema,
  },
  async ({ project, limit }) => {
    const rows = store.listSessions(project, limit);
    if (!rows.length) return text(`No sessions recorded for ${project}.`);
    const body = rows
      .map(
        (r) =>
          `#${r.id} ${r.created_at}${r.source ? ` [${r.source}]` : ""}` +
          `\n  ${r.title ? r.title + " — " : ""}${r.summary}` +
          (r.next_steps ? `\n  next: ${r.next_steps}` : "")
      )
      .join("\n");
    return text(body);
  }
);

server.registerTool(
  "scan_project",
  {
    title: "Scan Project",
    description:
      "Auto-populate long-term memory from a project directory: detect languages/frameworks, README summary, top-level structure, and ingest recent git commits. Run this once per project (or after big changes) so assistants start with real context.",
    inputSchema: scanProjectSchema,
  },
  async ({ path, project, commitLimit }) => {
    const scan = await scanProject(path, project);
    const proj = scan.project;

    for (const mem of scanToMemories(scan)) {
      await store.saveMemory({ project: proj, ...mem });
    }

    const commits = await readRecentCommits(path, commitLimit);
    const added = commits.length ? store.saveCommits(proj, commits) : 0;

    const lines = [
      `Scanned "${proj}" (${path}):`,
      `- Languages: ${scan.languages.join(", ") || "none detected"}`,
      `- Frameworks: ${scan.frameworks.join(", ") || "none detected"}`,
      `- Structure: ${scan.structure.join(", ") || "(flat)"}`,
      `- README: ${scan.readme ? "captured" : "not found"}`,
      `- Git: ${commits.length ? `${commits.length} commits read, ${added} new` : "no git repo"}`,
    ];
    return text(lines.join("\n"));
  }
);

server.registerTool(
  "get_recent_changes",
  {
    title: "Get Recent Changes",
    description:
      "List recently ingested git commits for a project (hash, date, message, files). Run scan_project first to populate.",
    inputSchema: getRecentChangesSchema,
  },
  async ({ project, limit }) => {
    const rows = store.recentCommits(project, limit);
    if (!rows.length)
      return text(`No commits stored for ${project}. Run scan_project first.`);
    const body = rows
      .map((c) => {
        const when = c.date ? c.date.slice(0, 10) : "";
        const files = c.files ? `\n  files: ${c.files}` : "";
        return `${c.hash.slice(0, 7)} ${when} — ${c.message}${c.author ? ` (${c.author})` : ""}${files}`;
      })
      .join("\n");
    return text(body);
  }
);

server.registerTool(
  "reindex_memories",
  {
    title: "Reindex Memories",
    description:
      "Backfill semantic embeddings for memories that don't have one yet (e.g. saved before semantic search was enabled). Run once after upgrading.",
    inputSchema: reindexMemoriesSchema,
  },
  async ({ project }) => {
    if (!store.semanticReady)
      return text("Semantic search is disabled; nothing to reindex.");
    const n = await store.reindexMemories(project);
    return text(`Reindexed ${n} memor${n === 1 ? "y" : "ies"}.`);
  }
);

server.registerTool(
  "watch_project",
  {
    title: "Watch Project",
    description:
      "Start watching a project directory for live file changes (create/modify/delete). Captures uncommitted work-in-progress, which then appears under 'Recently Active Files' in get_project_context. Watching lasts for this server session.",
    inputSchema: watchProjectSchema,
  },
  async ({ path, project }) => {
    const proj = project ?? basename(path.replace(/\/+$/, ""));
    const started = watcher.watch(proj, path, (e) =>
      store.recordFileEvent(proj, e.path, e.event)
    );
    return text(
      started
        ? `Watching "${proj}" at ${path}. File activity will be recorded.`
        : `Already watching "${proj}".`
    );
  }
);

server.registerTool(
  "unwatch_project",
  {
    title: "Unwatch Project",
    description: "Stop watching a project directory for file changes.",
    inputSchema: unwatchProjectSchema,
  },
  async ({ project }) => {
    const stopped = await watcher.unwatch(project);
    return text(stopped ? `Stopped watching "${project}".` : `"${project}" was not being watched.`);
  }
);

server.registerTool(
  "get_active_files",
  {
    title: "Get Active Files",
    description:
      "List recently changed files for a project (uncommitted activity captured by the watcher), most recent first.",
    inputSchema: getActiveFilesSchema,
  },
  async ({ project, limit }) => {
    const rows = store.activeFiles(project, limit);
    if (!rows.length) return text(`No recent file activity for ${project}. (Run watch_project to capture it.)`);
    const watching = watcher.isWatching(project) ? "" : "\n(note: not currently watching — these are from a previous session)";
    return text(rows.map((r) => `${r.event.padEnd(7)} ${r.path}`).join("\n") + watching);
  }
);

server.registerTool(
  "import_claude_sessions",
  {
    title: "Import Claude Sessions",
    description:
      "Auto-capture recent Claude Code sessions for a project by parsing its local transcripts (~/.claude/projects). Extracts the opening prompt, turn counts, and files touched into session memory — no manual save_session needed. Idempotent (dedupes by transcript id).",
    inputSchema: importClaudeSessionsSchema,
  },
  async ({ path, project, maxSessions }) => {
    const proj = project ?? basename(path.replace(/\/+$/, ""));
    const parsed = await importClaudeSessions(path, { maxSessions });
    if (!parsed.length)
      return text(`No Claude transcripts found for ${path}.`);
    let created = 0;
    for (const s of parsed) {
      const { created: isNew } = store.saveSession({
        project: proj,
        title: s.title,
        summary: s.summary,
        prompt: s.prompt,
        files: s.files,
        source: s.source,
        externalId: s.externalId,
        decisions: s.decisions,
        nextSteps: s.nextSteps,
      });
      if (isNew) created++;
    }
    return text(
      `Found ${parsed.length} transcript(s) for "${proj}"; imported ${created} new, ${parsed.length - created} already known.`
    );
  }
);

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description:
      "List all projects with memory/session counts and last activity, as JSON. Used by the VS Code dashboard.",
    inputSchema: listProjectsSchema,
  },
  async () => text(JSON.stringify(store.listProjects()))
);

server.registerTool(
  "get_dashboard",
  {
    title: "Get Dashboard",
    description:
      "Return a full structured snapshot of one project (memories by layer, recent sessions, active files, recent commits) as JSON. Used by the VS Code dashboard.",
    inputSchema: getDashboardSchema,
  },
  async ({ project }) => text(JSON.stringify(store.dashboard(project)))
);

server.registerTool(
  "delete_memory",
  {
    title: "Delete Memory",
    description:
      "Permanently delete a single memory by its id (irreversible). Also clears its semantic embedding so it stops appearing in search. Get ids from get_dashboard or search results.",
    inputSchema: deleteMemorySchema,
  },
  async ({ id }) =>
    text(store.deleteMemory(id) ? `Deleted memory #${id}.` : `No memory #${id} found.`)
);

server.registerTool(
  "delete_session",
  {
    title: "Delete Session",
    description:
      "Permanently delete a single session summary by its id (irreversible). Get ids from get_dashboard.",
    inputSchema: deleteSessionSchema,
  },
  async ({ id }) =>
    text(store.deleteSession(id) ? `Deleted session #${id}.` : `No session #${id} found.`)
);

server.registerTool(
  "delete_project",
  {
    title: "Delete Project",
    description:
      "Permanently delete an ENTIRE project and everything under it — all memories (and their embeddings), sessions, recorded file activity, and ingested commits (irreversible). Use with care.",
    inputSchema: deleteProjectSchema,
  },
  async ({ project }) => {
    const n = store.deleteProject(project);
    const total = n.memories + n.sessions + n.files + n.commits;
    if (!n.existed && total === 0) return text(`No project "${project}" found (nothing deleted).`);
    return text(
      `Deleted project "${project}" (${n.memories} memories, ${n.sessions} sessions, ${n.files} files, ${n.commits} commits).`
    );
  }
);

// --- MCP prompts: one-click flows for any MCP client (complements hooks/rules) ---

server.registerPrompt(
  "continue-project",
  {
    title: "Continue Project",
    description: "Load this project's UACE memory and continue where the last session left off.",
    argsSchema: { project: z.string().describe("Project name (usually the workspace folder name).") },
  },
  ({ project }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Continue project "${project}" using the uace MCP server. First call get_project_context for ` +
            `"${project}" to load prior decisions, the current task, recent changes, and where the last ` +
            `session left off. Then summarize the state and ask what to work on next — without making me ` +
            `re-explain the project.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "save-checkpoint",
  {
    title: "Save Checkpoint",
    description: "Persist a session checkpoint to UACE so any tool can continue later.",
    argsSchema: { project: z.string().describe("Project name (usually the workspace folder name).") },
  },
  ({ project }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Save a UACE checkpoint for project "${project}". Call save_session with a concise summary of ` +
            `what we did, the key decisions, the files touched, and concrete next steps. Also call ` +
            `save_memory for any durable architecture/standards (layer long-term) or current-task notes ` +
            `(layer working) worth keeping.`,
        },
      },
    ],
  })
);

server.registerTool(
  "prune_stale",
  {
    title: "Prune Stale Memory",
    description:
      "Find (and optionally delete) stale working/session memories and old file-activity events older than N days, so the brain self-cleans. Long-term memory is never touched. Dry-run by default — pass apply=true to actually delete.",
    inputSchema: pruneStaleSchema,
  },
  async ({ project, days, apply }) => {
    const r = store.pruneStale({ project, days, apply });
    const scope = project ? `"${project}"` : "all projects";
    if (!r.memories.length && !r.fileEvents) {
      return text(`Nothing older than ${r.days} days in ${scope}.`);
    }
    const head = r.applied
      ? `Pruned ${r.memories.length} memor${r.memories.length === 1 ? "y" : "ies"} and ${r.fileEvents} file event(s) older than ${r.days} days in ${scope}.`
      : `Would prune ${r.memories.length} memor${r.memories.length === 1 ? "y" : "ies"} and ${r.fileEvents} file event(s) older than ${r.days} days in ${scope} (dry-run; pass apply=true).`;
    const list = r.memories
      .slice(0, 20)
      .map((m) => `- #${m.id} [${m.layer}${m.key ? `/${m.key}` : ""}] ${m.content.slice(0, 80)}`)
      .join("\n");
    return text(list ? `${head}\n${list}` : head);
  }
);

async function shutdown(): Promise<void> {
  await watcher.closeAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP channel.
  console.error(
    `[uace] MCP server ready. DB: ${DB_PATH} | semantic search: ${
      vectorsEnabled ? `on (${embedder?.name})` : "off (keyword fallback)"
    }`
  );
}

main().catch((err) => {
  console.error("[uace] fatal:", err);
  process.exit(1);
});
