import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ParsedSession {
  externalId: string; // transcript session id (filename)
  title: string;
  summary: string;
  prompt: string;
  files: string[];
  source: string;
  decisions?: string; // heuristic decisions extracted from assistant turns
  nextSteps?: string; // heuristic next-steps / TODOs
  lastMessage?: string; // last assistant message — "where we left off"
}

/**
 * Claude Code stores transcripts at ~/.claude/projects/<encoded-cwd>/<id>.jsonl,
 * where the cwd is encoded by replacing non-alphanumeric chars with '-'.
 */
export function claudeTranscriptDir(projectPath: string): string {
  const encoded = projectPath.replace(/\/+$/, "").replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""
      )
      .join(" ")
      .trim();
  }
  return "";
}

const DECISION_RE = /\b(decided|decision|we chose|i chose|going with|the approach is|agreed to)\b/i;
const NEXT_RE = /\b(next step|next:|todo|to-?do|still need|remaining|follow-?up|then we|next we)\b/i;

/** Pull short, salient lines from assistant prose for the decisions/next-steps fields. */
function collectSignals(text: string, decisions: string[], next: string[]): void {
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/^[\s>*\-•\d.]+/, "").trim();
    if (line.length < 8 || line.length > 200) continue;
    if (decisions.length < 4 && DECISION_RE.test(line)) decisions.push(line);
    else if (next.length < 4 && NEXT_RE.test(line)) next.push(line);
  }
}

function collectFiles(content: unknown, into: Set<string>): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
      const input = (block as { input?: Record<string, unknown> }).input ?? {};
      const f = input.file_path ?? input.path ?? input.notebook_path;
      if (typeof f === "string") into.add(f);
    }
  }
}

/**
 * Parse the recent Claude Code transcripts for a project into session records.
 * Extraction-only (no LLM): captures the opening prompt, turn counts, and files
 * touched. Degrades to [] when no transcript directory exists.
 */
export async function importClaudeSessions(
  projectPath: string,
  opts: { maxSessions?: number } = {}
): Promise<ParsedSession[]> {
  const dir = claudeTranscriptDir(projectPath);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return []; // no transcripts for this project
  }

  // Most-recently-modified transcripts first.
  const withMtime = await Promise.all(
    files.map(async (f) => ({ f, m: (await stat(join(dir, f))).mtimeMs }))
  );
  withMtime.sort((a, b) => b.m - a.m);
  const pick = withMtime.slice(0, opts.maxSessions ?? 10);

  const sessions: ParsedSession[] = [];
  for (const { f } of pick) {
    try {
      const parsed = await parseTranscript(join(dir, f), f.replace(/\.jsonl$/, ""));
      if (parsed) sessions.push(parsed);
    } catch {
      /* skip unparseable transcript */
    }
  }
  return sessions;
}

export async function parseTranscript(
  file: string,
  externalId: string
): Promise<ParsedSession | null> {
  const raw = await readFile(file, "utf8");
  const files = new Set<string>();
  const decisions: string[] = [];
  const nextSteps: string[] = [];
  let firstPrompt = "";
  let lastAssistant = "";
  let userTurns = 0;
  let assistantTurns = 0;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: { type?: string; message?: { content?: unknown } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj.message?.content;
    if (obj.type === "user") {
      userTurns++;
      const text = extractText(content);
      if (!firstPrompt && text && !text.startsWith("<")) firstPrompt = text;
    } else if (obj.type === "assistant") {
      assistantTurns++;
      collectFiles(content, files);
      const text = extractText(content);
      if (text) {
        lastAssistant = text;
        collectSignals(text, decisions, nextSteps);
      }
    }
  }

  if (userTurns === 0 && assistantTurns === 0) return null;

  const fileList = [...files];
  const promptShort = firstPrompt.replace(/\s+/g, " ").slice(0, 200);
  const leftOff = lastAssistant.replace(/\s+/g, " ").trim().slice(0, 280);
  const title = promptShort ? promptShort.slice(0, 80) : `Claude session ${externalId.slice(0, 8)}`;
  const summary =
    `${userTurns} prompts / ${assistantTurns} replies.` +
    (promptShort ? ` First ask: "${promptShort}".` : "") +
    (fileList.length ? ` Files touched: ${fileList.slice(0, 12).join(", ")}.` : "") +
    (leftOff ? ` Left off: "${leftOff}".` : "");

  return {
    externalId,
    title,
    summary,
    prompt: promptShort,
    files: fileList,
    source: "claude-code-transcript",
    decisions: decisions.length ? decisions.join("; ") : undefined,
    nextSteps: nextSteps.length ? nextSteps.join("; ") : undefined,
    lastMessage: leftOff || undefined,
  };
}
