import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite-backed storage for the Universal AI Context Engine.
 *
 * Slice 1 uses FTS5 for keyword search; a later phase adds sqlite-vec for
 * semantic retrieval. The schema is intentionally small: projects, memories,
 * sessions — plus an FTS5 mirror of memories kept in sync via triggers.
 */
export function openDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/**
 * Load the sqlite-vec extension and create the embeddings table sized to `dim`.
 * Returns false (and leaves the DB fully usable for FTS) if the extension can't
 * load — semantic search is an enhancement, never a hard dependency.
 */
export function tryEnableVectors(db: Database.Database, dim: number): boolean {
  try {
    sqliteVec.load(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dim}]
      );
    `);
    return true;
  } catch (err) {
    console.error(
      `[uace] sqlite-vec unavailable (${(err as Error).message}); semantic search disabled.`
    );
    return false;
  }
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name        TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT NOT NULL,
      layer       TEXT NOT NULL CHECK (layer IN ('long-term','working','session')),
      key         TEXT,
      content     TEXT NOT NULL,
      tags        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Upsert target: at most one row per (project, layer, key) when key is set.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_unique_key
      ON memories(project, layer, key) WHERE key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_project_layer
      ON memories(project, layer);

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT NOT NULL,
      title       TEXT,
      summary     TEXT NOT NULL,
      prompt      TEXT,
      decisions   TEXT,
      files       TEXT,
      next_steps  TEXT,
      source      TEXT,
      external_id TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project
      ON sessions(project, created_at DESC);

    -- Live file activity captured by the watcher (uncommitted work signal).
    CREATE TABLE IF NOT EXISTS file_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT NOT NULL,
      path        TEXT NOT NULL,
      event       TEXT NOT NULL,
      ts          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_file_events_project
      ON file_events(project, ts DESC);

    -- Git commit history ingested by the scanner.
    CREATE TABLE IF NOT EXISTS commits (
      project     TEXT NOT NULL,
      hash        TEXT NOT NULL,
      author      TEXT,
      date        TEXT,
      message     TEXT NOT NULL,
      files       TEXT,
      PRIMARY KEY (project, hash)
    );

    CREATE INDEX IF NOT EXISTS idx_commits_project
      ON commits(project, date DESC);

    -- FTS5 mirror of memory content for keyword search.
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='id'
    );

    -- Keep the FTS index in sync with the memories table.
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.id, new.content, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.id, old.content, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.id, old.content, old.tags);
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.id, new.content, new.tags);
    END;
  `);

  // Forward-compat for DBs created before Phase 4: add columns if missing.
  // MUST run before creating any index that references the new column.
  addColumnIfMissing(db, "sessions", "external_id", "TEXT");

  db.exec(`
    -- Dedupe imported transcripts: one row per (project, external_id).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_external
      ON sessions(project, external_id) WHERE external_id IS NOT NULL;
  `);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
