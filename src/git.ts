import { simpleGit } from "simple-git";

export interface CommitInfo {
  hash: string;
  author: string;
  date: string; // ISO 8601
  message: string;
  files: string[];
}

// Field/record separators that won't appear in commit metadata.
const FS = "\x1f";
const RS = "\x1e";

/**
 * Read recent commits (with changed files) from a git repo in a single call.
 * Returns [] for non-git directories rather than throwing, so scanning a
 * non-repo folder degrades gracefully.
 */
export async function readRecentCommits(path: string, limit = 20): Promise<CommitInfo[]> {
  const git = simpleGit(path);

  if (!(await git.checkIsRepo().catch(() => false))) return [];

  let out: string;
  try {
    out = await git.raw([
      "log",
      `-n`,
      String(limit),
      "--no-merges",
      "--name-only",
      `--pretty=format:${RS}%H${FS}%an${FS}%aI${FS}%s`,
    ]);
  } catch {
    // Empty repo (no commits yet) or other log failure — degrade gracefully.
    return [];
  }

  const commits: CommitInfo[] = [];
  for (const chunk of out.split(RS)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const [hash, author, date, message] = lines[0].split(FS);
    if (!hash) continue;
    const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);
    commits.push({ hash, author, date, message, files });
  }
  return commits;
}
