import { z } from "zod";

/**
 * Memory layers, per the UACE design:
 *  - long-term: architecture, coding standards, folder structure, business rules, tech stack
 *  - working:   current sprint/task, TODOs, active branch, open issues
 *  - session:   current discussion, temporary decisions, recent prompts, next steps
 */
export const MEMORY_LAYERS = ["long-term", "working", "session"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export interface MemoryRow {
  id: number;
  project: string;
  layer: MemoryLayer;
  key: string | null;
  content: string;
  tags: string | null; // comma-separated
  created_at: string;
  updated_at: string;
}

export interface CommitRow {
  project: string;
  hash: string;
  author: string | null;
  date: string | null;
  message: string;
  files: string | null; // comma-separated
}

export interface SessionRow {
  id: number;
  project: string;
  title: string | null;
  summary: string;
  prompt: string | null;
  decisions: string | null;
  files: string | null; // comma-separated
  next_steps: string | null;
  source: string | null; // which AI tool wrote it (claude-code, cursor, ...)
  created_at: string;
}

// ---- zod schemas for MCP tool inputs ----

const projectField = z
  .string()
  .min(1)
  .describe("Project identifier (e.g. repo name or absolute path).");

export const saveMemorySchema = {
  project: projectField,
  layer: z
    .enum(MEMORY_LAYERS)
    .default("long-term")
    .describe("Memory layer: long-term | working | session."),
  key: z
    .string()
    .optional()
    .describe(
      "Optional stable key. Re-saving with the same project+layer+key updates in place (upsert)."
    ),
  content: z.string().min(1).describe("The fact/decision/context to remember."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional tags for filtering."),
};

export const searchMemorySchema = {
  project: projectField,
  query: z.string().min(1).describe("Full-text search query (FTS5 syntax allowed)."),
  layer: z
    .enum(MEMORY_LAYERS)
    .optional()
    .describe("Optional: restrict to one memory layer."),
  limit: z.number().int().positive().max(50).default(10),
};

export const getProjectContextSchema = {
  project: projectField,
  query: z
    .string()
    .optional()
    .describe(
      "Optional question/topic. When given, the packet adds a semantically-ranked 'Most Relevant' section for it."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(20)
    .describe("Max memories per layer to include in the context packet."),
};

export const reindexMemoriesSchema = {
  project: z
    .string()
    .optional()
    .describe("Optional project to limit reindexing to. Omit for all projects."),
};

export const watchProjectSchema = {
  path: z.string().min(1).describe("Absolute path of the project directory to watch."),
  project: z
    .string()
    .optional()
    .describe("Project id to record events under. Defaults to the directory name."),
};

export const unwatchProjectSchema = {
  project: projectField,
};

export const getActiveFilesSchema = {
  project: projectField,
  limit: z.number().int().positive().max(50).default(15),
};

export const listProjectsSchema = {};

export const getDashboardSchema = {
  project: projectField,
};

export const importClaudeSessionsSchema = {
  path: z
    .string()
    .min(1)
    .describe("Absolute project path whose Claude Code transcripts should be imported."),
  project: z
    .string()
    .optional()
    .describe("Project id to store sessions under. Defaults to the directory name."),
  maxSessions: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe("How many of the most recent transcripts to import."),
};

export const saveSessionSchema = {
  project: projectField,
  summary: z.string().min(1).describe("Concise summary of what happened this session."),
  title: z.string().optional(),
  prompt: z.string().optional().describe("The driving user prompt/goal."),
  decisions: z.string().optional().describe("Decisions made this session."),
  files: z.array(z.string()).optional().describe("Files referenced or changed."),
  nextSteps: z.string().optional().describe("What to do next."),
  source: z
    .string()
    .optional()
    .describe("Which AI tool is saving this (e.g. claude-code, cursor)."),
};

export const listSessionsSchema = {
  project: projectField,
  limit: z.number().int().positive().max(50).default(10),
};

export const scanProjectSchema = {
  path: z
    .string()
    .min(1)
    .describe("Absolute path to the project directory to scan."),
  project: z
    .string()
    .optional()
    .describe("Project id to store under. Defaults to the directory name."),
  commitLimit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe("How many recent git commits to ingest."),
};

export const getRecentChangesSchema = {
  project: projectField,
  limit: z.number().int().positive().max(50).default(10),
};

export const deleteMemorySchema = {
  id: z
    .number()
    .int()
    .positive()
    .describe("Memory id to delete (from get_dashboard or search results)."),
};

export const deleteSessionSchema = {
  id: z.number().int().positive().describe("Session id to delete."),
};

export const deleteProjectSchema = {
  project: projectField,
};

export const pruneStaleSchema = {
  project: z.string().optional().describe("Limit to one project (default: all projects)."),
  days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Age threshold in days; working/session memories and file events older than this are candidates (default 30)."),
  apply: z
    .boolean()
    .optional()
    .describe("Actually delete the candidates. Default false = dry-run (returns what WOULD be pruned)."),
};
