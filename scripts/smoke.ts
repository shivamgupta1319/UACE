/**
 * Smoke test for the UACE memory core — no MCP client, no network required.
 * Run: npm run smoke
 *
 * Semantic search is exercised with a small DETERMINISTIC embedder so the test
 * is fast and offline; the real Transformers.js model is verified separately in
 * the MCP handshake check.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { openDb, tryEnableVectors } from "../src/db.js";
import { MemoryStore } from "../src/memory.js";
import { scanProject } from "../src/scanner.js";
import { readRecentCommits } from "../src/git.js";
import { claudeTranscriptDir, importClaudeSessions } from "../src/transcripts.js";
import type { Embedder } from "../src/embedder.js";

// Deterministic keyword embedder: each vocab word owns one dimension.
const VOCAB = [
  "auth", "login", "jwt", "token",
  "payment", "stripe", "billing", "invoice",
];
const fakeEmbedder: Embedder = {
  name: "fake-keyword",
  dim: VOCAB.length,
  async ready() { return true; },
  async embed(text: string) {
    const lower = text.toLowerCase();
    const v = VOCAB.map((w) => (lower.includes(w) ? 1 : 0));
    const norm = Math.hypot(...v) || 1;
    // uniform tiny vector when nothing matches, to avoid a zero-norm vector
    return norm === 1 && v.every((x) => x === 0)
      ? VOCAB.map(() => 1 / Math.sqrt(VOCAB.length))
      : v.map((x) => x / norm);
  },
};

const db = openDb(":memory:");
const vectorsEnabled = tryEnableVectors(db, fakeEmbedder.dim);
assert.ok(vectorsEnabled, "sqlite-vec should load");
const store = new MemoryStore(db, { embedder: fakeEmbedder, vectorsEnabled });
assert.ok(store.semanticReady, "semantic search should be active");

const project = "demo-project";

// 1. save_memory across layers
await store.saveMemory({
  project,
  layer: "long-term",
  key: "stack",
  content: "TypeScript + better-sqlite3, MCP stdio server, local-first.",
  tags: ["architecture"],
});
await store.saveMemory({
  project,
  layer: "working",
  key: "task",
  content: "Implement Phase 1: core MCP memory server.",
});

// 2. upsert: re-saving the same key updates in place (no duplicate row)
const updated = await store.saveMemory({
  project,
  layer: "working",
  key: "task",
  content: "Implement Phase 1: core MCP memory server. (smoke verified)",
});
const working = store.recentByLayer(project, "working", 10);
assert.equal(working.length, 1, "upsert should not create a duplicate row");
assert.match(working[0].content, /smoke verified/, "upsert should update content");
assert.equal(updated.id, working[0].id, "upsert should return the same row id");

// 3. search_memory (FTS) finds it
const hits = store.searchMemory({ project, query: "MCP server", limit: 10 });
assert.ok(hits.length >= 1, "FTS search should find at least one memory");
const safe = store.searchMemory({ project, query: "local-first: stack?", limit: 5 });
assert.ok(Array.isArray(safe), "punctuated query should be sanitized, not throw");

// 4. SEMANTIC search ranks by meaning, not keywords
await store.saveMemory({
  project,
  layer: "long-term",
  key: "auth",
  content: "We use JWT token auth for login.",
});
await store.saveMemory({
  project,
  layer: "long-term",
  key: "payments",
  content: "Stripe handles billing and invoice payment.",
});
const sem = await store.semanticSearch({ project, query: "how does login work", limit: 1 });
assert.ok(sem && sem.length === 1, "semantic search should return a result");
assert.equal(sem![0].key, "auth", "semantic top hit for 'login' should be the auth memory");

const sem2 = await store.semanticSearch({ project, query: "stripe invoice billing", limit: 1 });
assert.equal(sem2![0].key, "payments", "semantic top hit for billing terms should be payments");

// 5. reindex backfills any memory missing an embedding
const noVec = openDb(":memory:");
const ok2 = tryEnableVectors(noVec, fakeEmbedder.dim);
const store2 = new MemoryStore(noVec, { embedder: fakeEmbedder, vectorsEnabled: ok2 });
// insert directly (bypass embedding) to simulate legacy rows
noVec.prepare(`INSERT INTO memories(project, layer, content) VALUES (?, 'long-term', ?)`)
  .run(project, "legacy jwt auth note");
const reindexed = await store2.reindexMemories(project);
assert.equal(reindexed, 1, "reindex should embed the one legacy memory");
const found = await store2.semanticSearch({ project, query: "login auth", limit: 1 });
assert.ok(found && found.length === 1, "reindexed memory should be searchable");

// 6. save_session + list_sessions
store.saveSession({
  project,
  title: "Phase 3 build",
  summary: "Added semantic search with sqlite-vec + local embeddings.",
  nextSteps: "Wire file watcher (Phase 4).",
  source: "claude-code",
});
assert.equal(store.listSessions(project, 10).length, 1, "one session recorded");

// 7. context packet: layered memory + semantic 'Most Relevant' for a query
const packet = await store.buildContextPacket(project, 20, "login authentication");
assert.match(packet, /Long-Term Memory/);
assert.match(packet, /Most Relevant to: "login authentication"/);
assert.match(packet, /JWT token auth/, "relevant section should surface the auth memory");

// 8. cross-project isolation
const empty = await store.buildContextPacket("other-project", 20);
assert.match(empty, /No memories stored yet/);

// 9. scanner + git on this repo
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scan = await scanProject(repoRoot, "uace-self");
assert.ok(scan.languages.includes("TypeScript"), "should detect TypeScript");
assert.ok(scan.frameworks.includes("MCP"), "should detect MCP framework");
assert.ok(scan.structure.includes("src"), "should list src/ in structure");
const commits = await readRecentCommits(repoRoot, 10);
const added = store.saveCommits("uace-self", commits);
assert.equal(added, commits.length, "all read commits should be newly inserted");
if (commits.length) {
  assert.equal(store.saveCommits("uace-self", commits), 0, "re-ingest adds nothing");
}

// 10. Phase 4 — file activity feeds the context packet
store.recordFileEvent(project, "src/server.ts", "change");
store.recordFileEvent(project, "src/new-feature.ts", "add");
const activeNow = store.activeFiles(project, 10);
assert.ok(
  activeNow.find((f) => f.path === "src/new-feature.ts" && f.event === "add"),
  "active files should include the new file"
);
const packet4 = await store.buildContextPacket(project, 20);
assert.match(packet4, /Recently Active Files/, "packet should show active files");
assert.match(packet4, /src\/new-feature\.ts \(new\)/, "new file tagged (new)");

// 11. Phase 4 — session dedupe by external_id (idempotent transcript import)
const s1 = store.saveSession({ project, summary: "imported once", externalId: "abc-123" });
assert.equal(s1.created, true, "first import creates a session");
const s2 = store.saveSession({ project, summary: "imported again", externalId: "abc-123" });
assert.equal(s2.created, false, "same external_id must not duplicate");
assert.equal(s1.row.id, s2.row.id, "dedupe returns the existing row");

// 12. Phase 4 — parse a synthetic Claude Code transcript
const fakeHome = join(dirname(fileURLToPath(import.meta.url)), "..", ".smoke-home");
process.env.HOME = fakeHome;
const projPath = "/tmp/uace-smoke/proj-xyz";
const tdir = claudeTranscriptDir(projPath);
mkdirSync(tdir, { recursive: true });
writeFileSync(
  join(tdir, "sess1.jsonl"),
  [
    JSON.stringify({ type: "user", message: { content: "Help me build the auth login module" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "On it." },
          { type: "tool_use", name: "Edit", input: { file_path: `${projPath}/auth.ts` } },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "We decided to use JWT for sessions.\nNext step: wire the refresh-token endpoint.",
          },
        ],
      },
    }),
  ].join("\n")
);
const parsed = await importClaudeSessions(projPath);
rmSync(fakeHome, { recursive: true, force: true });
assert.equal(parsed.length, 1, "should parse one transcript");
assert.match(parsed[0].summary, /auth login module/, "summary captures the opening prompt");
assert.ok(parsed[0].files.includes(`${projPath}/auth.ts`), "should capture files touched");
assert.equal(parsed[0].source, "claude-code-transcript");
// Phase 4 — richer capture: decisions, next steps, and "where we left off".
assert.match(parsed[0].decisions ?? "", /JWT/, "should extract a decision line");
assert.match(parsed[0].nextSteps ?? "", /refresh-token/, "should extract a next-step line");
assert.match(parsed[0].lastMessage ?? "", /refresh-token endpoint/, "lastMessage = where we left off");
assert.match(parsed[0].summary, /Left off:/, "summary includes where we left off");

// 13. DELETE — memory delete also purges its embedding (no orphan vector)
const vecCount = (id: number): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM vec_memories WHERE memory_id = ?`).get(BigInt(id)) as { n: number }).n;

const delMem = await store.saveMemory({
  project,
  layer: "long-term",
  key: "to-delete",
  content: "ephemeral jwt token note to be deleted",
});
assert.equal(vecCount(delMem.id), 1, "saved memory should have an embedding row");
const removed = store.deleteMemory(delMem.id);
assert.equal(removed, true, "deleteMemory should report a removed row");
assert.equal(store.getMemory(delMem.id), undefined, "memory row should be gone");
assert.equal(vecCount(delMem.id), 0, "embedding must be purged (no orphan vector)");
assert.ok(
  !store.searchMemory({ project, query: "ephemeral", limit: 10 }).some((r) => r.id === delMem.id),
  "FTS should no longer return the deleted memory"
);
assert.ok(
  !(await store.semanticSearch({ project, query: "ephemeral jwt token", limit: 10 }))?.some(
    (r) => r.id === delMem.id
  ),
  "semantic search should no longer return the deleted memory"
);
assert.equal(store.deleteMemory(delMem.id), false, "deleting a missing memory returns false");

// 14. DELETE — session delete
const delSess = store.saveSession({ project, summary: "session to delete" });
assert.equal(store.deleteSession(delSess.row.id), true, "deleteSession should remove the row");
assert.ok(
  !store.listSessions(project, 50).some((s) => s.id === delSess.row.id),
  "deleted session should not be listed"
);

// 15. DELETE — project cascade purges every table (and embeddings)
const purgeProj = "throwaway-project";
const pm = await store.saveMemory({ project: purgeProj, layer: "long-term", key: "k", content: "stripe billing note" });
store.saveSession({ project: purgeProj, summary: "a session" });
store.recordFileEvent(purgeProj, "src/x.ts", "change");
store.saveCommits(purgeProj, [
  { hash: "deadbeef", author: "me", date: "2026-01-01", message: "init", files: ["a.ts"] },
]);
assert.equal(vecCount(pm.id), 1, "project memory should be embedded before purge");
const purged = store.deleteProject(purgeProj);
assert.equal(purged.memories, 1, "one memory purged");
assert.equal(purged.sessions, 1, "one session purged");
assert.equal(purged.files, 1, "one file event purged");
assert.equal(purged.commits, 1, "one commit purged");
assert.equal(vecCount(pm.id), 0, "project memory embeddings must be purged");
assert.ok(
  !store.listProjects().some((p) => p.name === purgeProj),
  "purged project should be gone from listProjects"
);
assert.equal(purged.existed, true, "deleteProject should report the project row existed");

// 15b. DELETE — emptied-but-existing project still counts as a real deletion
const emptyProj = "emptied-project";
const ep = await store.saveMemory({ project: emptyProj, layer: "long-term", key: "only", content: "sole memory" });
store.deleteMemory(ep.id); // leaves an empty project row behind
assert.ok(store.listProjects().some((p) => p.name === emptyProj), "empty project row should remain");
const emptied = store.deleteProject(emptyProj);
assert.equal(emptied.existed, true, "deleting an emptied project must report existed=true");
assert.equal(emptied.memories, 0, "emptied project has no memories to count");
assert.ok(
  !store.listProjects().some((p) => p.name === emptyProj),
  "emptied project row should be removed"
);
// Deleting a truly-absent project reports existed=false.
assert.equal(store.deleteProject("never-existed").existed, false, "absent project reports existed=false");

console.log(
  `✓ smoke passed — save/upsert/FTS + semantic + reindex + session/context + scan(${scan.languages.join("/")}) + git(${commits.length}) + watcher/activeFiles + transcript-import + delete(memory/session/project)`
);
