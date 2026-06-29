import type Database from "better-sqlite3";
import type { CommitInfo } from "./git.js";
import type { Embedder } from "./embedder.js";
import type { CommitRow, MemoryLayer, MemoryRow, SessionRow } from "./types.js";
import { MEMORY_LAYERS } from "./types.js";

export interface MemoryStoreOptions {
  embedder?: Embedder | null;
  /** True when sqlite-vec loaded and the vec_memories table exists. */
  vectorsEnabled?: boolean;
}

/**
 * The MemoryStore is the heart of the engine: it owns all reads/writes against
 * SQLite and produces the compact "context packet" handed to an AI assistant.
 */
export class MemoryStore {
  private embedder: Embedder | null;
  private vectorsEnabled: boolean;

  constructor(private db: Database.Database, opts: MemoryStoreOptions = {}) {
    this.embedder = opts.embedder ?? null;
    this.vectorsEnabled = Boolean(opts.vectorsEnabled && this.embedder);
  }

  /** Whether semantic search is active (vec table + embedder both available). */
  get semanticReady(): boolean {
    return this.vectorsEnabled;
  }

  /** Upsert a memory's embedding into the vec table (no-op if disabled). */
  private async indexEmbedding(id: number, content: string): Promise<void> {
    if (!this.vectorsEnabled || !this.embedder) return;
    const vec = await this.embedder.embed(content);
    if (!vec) return;
    const json = JSON.stringify(vec);
    this.db.prepare(`DELETE FROM vec_memories WHERE memory_id = ?`).run(BigInt(id));
    this.db
      .prepare(`INSERT INTO vec_memories(memory_id, embedding) VALUES (?, ?)`)
      .run(BigInt(id), json);
  }

  private ensureProject(project: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO projects(name) VALUES (?)`)
      .run(project);
  }

  /** Insert or update a memory. With a key, re-saving upserts in place. */
  async saveMemory(input: {
    project: string;
    layer: MemoryLayer;
    key?: string;
    content: string;
    tags?: string[];
  }): Promise<MemoryRow> {
    this.ensureProject(input.project);
    const tags = input.tags?.length ? input.tags.join(",") : null;

    if (input.key) {
      const existing = this.db
        .prepare(
          `SELECT id FROM memories WHERE project = ? AND layer = ? AND key = ?`
        )
        .get(input.project, input.layer, input.key) as { id: number } | undefined;
      if (existing) {
        this.db
          .prepare(
            `UPDATE memories
               SET content = ?, tags = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(input.content, tags, existing.id);
        await this.indexEmbedding(existing.id, input.content);
        return this.getMemory(existing.id)!;
      }
    }

    const info = this.db
      .prepare(
        `INSERT INTO memories(project, layer, key, content, tags)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.project, input.layer, input.key ?? null, input.content, tags);
    const id = Number(info.lastInsertRowid);
    await this.indexEmbedding(id, input.content);
    return this.getMemory(id)!;
  }

  getMemory(id: number): MemoryRow | undefined {
    return this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | MemoryRow
      | undefined;
  }

  /** Clear a memory's embedding from the vec table (no-op if disabled). */
  private deleteEmbedding(id: number): void {
    if (!this.vectorsEnabled) return;
    this.db.prepare(`DELETE FROM vec_memories WHERE memory_id = ?`).run(BigInt(id));
  }

  /**
   * Delete one memory by id. Also clears its embedding from vec_memories — the
   * FTS mirror auto-cleans via the memories_ad trigger, but vec0 has no such
   * trigger, so an orphan vector would otherwise linger in semantic search.
   * Returns true if a row was removed.
   */
  deleteMemory(id: number): boolean {
    const drop = this.db.transaction((mid: number) => {
      this.deleteEmbedding(mid);
      return this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(mid).changes;
    });
    return drop(id) > 0;
  }

  /** Delete one session by id. Sessions have no embeddings/FTS. */
  deleteSession(id: number): boolean {
    return this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id).changes > 0;
  }

  /**
   * Delete a project and everything under it: memories (+ their embeddings),
   * sessions, file events and ingested commits, then the project row itself.
   * Returns per-table counts. Embeddings are cleared first because vec0 has no
   * delete trigger.
   */
  deleteProject(project: string): {
    memories: number;
    sessions: number;
    files: number;
    commits: number;
  } {
    const purge = this.db.transaction((name: string) => {
      if (this.vectorsEnabled) {
        this.db
          .prepare(
            `DELETE FROM vec_memories
              WHERE memory_id IN (SELECT id FROM memories WHERE project = ?)`
          )
          .run(name);
      }
      const memories = this.db.prepare(`DELETE FROM memories WHERE project = ?`).run(name).changes;
      const sessions = this.db.prepare(`DELETE FROM sessions WHERE project = ?`).run(name).changes;
      const files = this.db.prepare(`DELETE FROM file_events WHERE project = ?`).run(name).changes;
      const commits = this.db.prepare(`DELETE FROM commits WHERE project = ?`).run(name).changes;
      this.db.prepare(`DELETE FROM projects WHERE name = ?`).run(name);
      return { memories, sessions, files, commits };
    });
    return purge(project);
  }

  /** Full-text search within a project, optionally scoped to one layer. */
  searchMemory(input: {
    project: string;
    query: string;
    layer?: MemoryLayer;
    limit: number;
  }): MemoryRow[] {
    const params: unknown[] = [input.project, sanitizeFts(input.query)];
    let sql = `
      SELECT m.*
        FROM memories_fts f
        JOIN memories m ON m.id = f.rowid
       WHERE m.project = ?
         AND memories_fts MATCH ?`;
    if (input.layer) {
      sql += ` AND m.layer = ?`;
      params.push(input.layer);
    }
    sql += ` ORDER BY bm25(memories_fts) LIMIT ?`;
    params.push(input.limit);
    return this.db.prepare(sql).all(...params) as MemoryRow[];
  }

  /**
   * Semantic (vector) search within a project. Embeds the query, runs KNN over
   * the vec table, then joins back and filters by project/layer. Over-fetches
   * from the KNN scan so project filtering doesn't starve results.
   * Returns null when semantic search is unavailable (caller falls back to FTS).
   */
  async semanticSearch(input: {
    project: string;
    query: string;
    layer?: MemoryLayer;
    limit: number;
  }): Promise<(MemoryRow & { distance: number })[] | null> {
    if (!this.vectorsEnabled || !this.embedder) return null;
    const qv = await this.embedder.embed(input.query);
    if (!qv) return null;

    const overfetch = Math.max(input.limit * 10, 50);
    const params: unknown[] = [JSON.stringify(qv), overfetch, input.project];
    let sql = `
      WITH knn AS (
        SELECT memory_id, distance
          FROM vec_memories
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?
      )
      SELECT m.*, knn.distance AS distance
        FROM knn
        JOIN memories m ON m.id = knn.memory_id
       WHERE m.project = ?`;
    if (input.layer) {
      sql += ` AND m.layer = ?`;
      params.push(input.layer);
    }
    sql += ` ORDER BY knn.distance LIMIT ?`;
    params.push(input.limit);
    return this.db.prepare(sql).all(...params) as (MemoryRow & {
      distance: number;
    })[];
  }

  /**
   * Backfill embeddings for memories that don't have one yet (e.g. saved before
   * embeddings were enabled). Returns the number of memories embedded.
   */
  async reindexMemories(project?: string): Promise<number> {
    if (!this.vectorsEnabled || !this.embedder) return 0;
    const rows = (
      project
        ? this.db
            .prepare(
              `SELECT m.id, m.content FROM memories m
                 LEFT JOIN vec_memories v ON v.memory_id = m.id
                WHERE v.memory_id IS NULL AND m.project = ?`
            )
            .all(project)
        : this.db
            .prepare(
              `SELECT m.id, m.content FROM memories m
                 LEFT JOIN vec_memories v ON v.memory_id = m.id
                WHERE v.memory_id IS NULL`
            )
            .all()
    ) as { id: number; content: string }[];

    let count = 0;
    for (const r of rows) {
      await this.indexEmbedding(r.id, r.content);
      count++;
    }
    return count;
  }

  /** Most-recent memories in a layer (used to build the context packet). */
  recentByLayer(project: string, layer: MemoryLayer, limit: number): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM memories
          WHERE project = ? AND layer = ?
          ORDER BY updated_at DESC
          LIMIT ?`
      )
      .all(project, layer, limit) as MemoryRow[];
  }

  saveSession(input: {
    project: string;
    summary: string;
    title?: string;
    prompt?: string;
    decisions?: string;
    files?: string[];
    nextSteps?: string;
    source?: string;
    externalId?: string;
  }): { row: SessionRow; created: boolean } {
    this.ensureProject(input.project);

    // Dedupe imported transcripts: skip if this external_id already exists.
    if (input.externalId) {
      const existing = this.db
        .prepare(`SELECT * FROM sessions WHERE project = ? AND external_id = ?`)
        .get(input.project, input.externalId) as SessionRow | undefined;
      if (existing) return { row: existing, created: false };
    }

    const info = this.db
      .prepare(
        `INSERT INTO sessions(project, title, summary, prompt, decisions, files, next_steps, source, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.project,
        input.title ?? null,
        input.summary,
        input.prompt ?? null,
        input.decisions ?? null,
        input.files?.length ? input.files.join(",") : null,
        input.nextSteps ?? null,
        input.source ?? null,
        input.externalId ?? null
      );
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as SessionRow;
    return { row, created: true };
  }

  /** Project summaries for the dashboard's top level. */
  listProjects(): {
    name: string;
    memories: number;
    sessions: number;
    lastActivity: string | null;
  }[] {
    return this.db
      .prepare(
        `SELECT p.name AS name,
                (SELECT COUNT(*) FROM memories m WHERE m.project = p.name) AS memories,
                (SELECT COUNT(*) FROM sessions s WHERE s.project = p.name) AS sessions,
                MAX(
                  COALESCE((SELECT MAX(updated_at) FROM memories m WHERE m.project = p.name), ''),
                  COALESCE((SELECT MAX(created_at) FROM sessions s WHERE s.project = p.name), ''),
                  COALESCE((SELECT MAX(ts) FROM file_events f WHERE f.project = p.name), '')
                ) AS lastActivity
           FROM projects p
          ORDER BY lastActivity DESC`
      )
      .all() as { name: string; memories: number; sessions: number; lastActivity: string | null }[];
  }

  /** Full structured snapshot of one project for the dashboard tree. */
  dashboard(project: string): {
    project: string;
    memories: Record<MemoryLayer, MemoryRow[]>;
    sessions: SessionRow[];
    activeFiles: { path: string; event: string; ts: string }[];
    commits: CommitRow[];
  } {
    const memories = {} as Record<MemoryLayer, MemoryRow[]>;
    for (const layer of MEMORY_LAYERS) {
      memories[layer] = this.recentByLayer(project, layer, 50);
    }
    return {
      project,
      memories,
      sessions: this.listSessions(project, 15),
      activeFiles: this.activeFiles(project, 15),
      commits: this.recentCommits(project, 15),
    };
  }

  /** Record a single file-activity event from the watcher. */
  recordFileEvent(project: string, path: string, event: string): void {
    this.ensureProject(project);
    this.db
      .prepare(`INSERT INTO file_events(project, path, event) VALUES (?, ?, ?)`)
      .run(project, path, event);
  }

  /** Distinct recently-active files (latest event per path). */
  activeFiles(project: string, limit: number): { path: string; event: string; ts: string }[] {
    return this.db
      .prepare(
        `SELECT path, event, MAX(ts) AS ts
           FROM file_events
          WHERE project = ?
          GROUP BY path
          ORDER BY ts DESC
          LIMIT ?`
      )
      .all(project, limit) as { path: string; event: string; ts: string }[];
  }

  listSessions(project: string, limit: number): SessionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM sessions
          WHERE project = ?
          ORDER BY created_at DESC
          LIMIT ?`
      )
      .all(project, limit) as SessionRow[];
  }

  /** Upsert ingested git commits. Returns how many were newly inserted. */
  saveCommits(project: string, commits: CommitInfo[]): number {
    this.ensureProject(project);
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO commits(project, hash, author, date, message, files)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertAll = this.db.transaction((rows: CommitInfo[]) => {
      let added = 0;
      for (const c of rows) {
        const info = stmt.run(
          project,
          c.hash,
          c.author,
          c.date,
          c.message,
          c.files.length ? c.files.join(",") : null
        );
        added += info.changes;
      }
      return added;
    });
    return insertAll(commits);
  }

  recentCommits(project: string, limit: number): CommitRow[] {
    return this.db
      .prepare(
        `SELECT * FROM commits
          WHERE project = ?
          ORDER BY date DESC
          LIMIT ?`
      )
      .all(project, limit) as CommitRow[];
  }

  /**
   * Build a compact, human-readable context packet: layered memory plus the
   * most recent session. This is what an assistant pulls at session start so
   * the user doesn't have to re-explain the project.
   */
  async buildContextPacket(
    project: string,
    limitPerLayer: number,
    query?: string
  ): Promise<string> {
    const sections: string[] = [`# Project Context: ${project}`];

    // Optional semantic focus: most relevant memories for a specific question.
    if (query) {
      const relevant = await this.semanticSearch({
        project,
        query,
        limit: Math.min(limitPerLayer, 8),
      });
      if (relevant && relevant.length) {
        sections.push(`\n## Most Relevant to: "${query}"`);
        for (const r of relevant) {
          const label = r.key ? `**${r.key}**: ` : "";
          sections.push(`- [${r.layer}] ${label}${r.content}`);
        }
      }
    }

    const layerTitles: Record<MemoryLayer, string> = {
      "long-term": "Long-Term Memory (architecture, standards, stack)",
      working: "Working Memory (current task, TODOs, branch)",
      session: "Session Memory (recent decisions, next steps)",
    };

    for (const layer of MEMORY_LAYERS) {
      const rows = this.recentByLayer(project, layer, limitPerLayer);
      if (!rows.length) continue;
      sections.push(`\n## ${layerTitles[layer]}`);
      for (const r of rows) {
        const label = r.key ? `**${r.key}**: ` : "";
        sections.push(`- ${label}${r.content}`);
      }
    }

    const commits = this.recentCommits(project, 5);
    if (commits.length) {
      sections.push(`\n## Recent Changes (git)`);
      for (const c of commits) {
        const when = c.date ? c.date.slice(0, 10) : "";
        sections.push(`- ${c.hash.slice(0, 7)} ${when} ${c.message}`);
      }
    }

    const active = this.activeFiles(project, 8);
    if (active.length) {
      sections.push(`\n## Recently Active Files (uncommitted work)`);
      for (const a of active) {
        const tag = a.event === "unlink" ? " (deleted)" : a.event === "add" ? " (new)" : "";
        sections.push(`- ${a.path}${tag}`);
      }
    }

    const [lastSession] = this.listSessions(project, 1);
    if (lastSession) {
      sections.push(`\n## Last Session`);
      if (lastSession.title) sections.push(`**${lastSession.title}**`);
      sections.push(lastSession.summary);
      if (lastSession.next_steps) {
        sections.push(`\n**Next steps:** ${lastSession.next_steps}`);
      }
    }

    if (sections.length === 1) {
      sections.push(
        "\n_No memories stored yet for this project. Use save_memory / save_session to populate it._"
      );
    }
    return sections.join("\n");
  }
}

/**
 * FTS5 treats characters like `-`, `:`, `.` as syntax. We defensively quote each
 * token so natural-language queries don't throw, while still allowing the `*`
 * prefix-match operator.
 */
function sanitizeFts(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+\*?/gu);
  if (!tokens || tokens.length === 0) return '""';
  return tokens
    .map((t) => (t.endsWith("*") ? `"${t.slice(0, -1)}"*` : `"${t}"`))
    .join(" OR ");
}
