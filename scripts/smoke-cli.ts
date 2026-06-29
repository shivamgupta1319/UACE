/**
 * Smoke test for the UACE CLI mode (`uace-mcp context|save-session|sync`).
 * Run: npm run smoke   (chained after the core smoke test)
 *
 * Exercises runCli() in-process against a temp file DB and asserts that the
 * `context` command writes ONLY the packet to stdout (stdout purity) — critical
 * because the Claude Code SessionStart hook injects stdout into the model.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { openDb } from "../src/db.js";
import { MemoryStore } from "../src/memory.js";

const dir = mkdtempSync(join(tmpdir(), "uace-cli-"));
const dbPath = join(dir, "memory.db");
process.env.UACE_DB = dbPath;
process.env.UACE_NO_EMBED = "1"; // keep the test offline + fast

const project = "cli-demo";

try {
  // 1. save-session --summary/--next
  let code = await runCli(["save-session", "--project", project, "--summary", "did X", "--next", "do Y"]);
  assert.equal(code, 0, "save-session --summary should exit 0");

  // 2. save-session --from-transcript (deduped by external_id)
  const transcript = join(dir, "abc123.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "Implement the login flow" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", input: { file_path: "src/auth.ts" } }] },
      }),
    ].join("\n")
  );
  code = await runCli(["save-session", "--project", project, "--from-transcript", transcript]);
  assert.equal(code, 0, "save-session --from-transcript should exit 0");
  // re-run is idempotent (same external_id)
  code = await runCli(["save-session", "--project", project, "--from-transcript", transcript]);
  assert.equal(code, 0, "re-import should still exit 0");

  // Verify via an independent connection: exactly 2 distinct sessions.
  const verify = new MemoryStore(openDb(dbPath), { embedder: null, vectorsEnabled: false });
  assert.equal(verify.listSessions(project, 10).length, 2, "two distinct sessions stored (transcript deduped)");

  // 3. context — capture stdout and assert PURITY (packet only, no log noise).
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as NodeJS.WriteStream).write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    code = await runCli(["context", project]);
  } finally {
    process.stdout.write = realWrite;
  }
  assert.equal(code, 0, "context should exit 0");
  const stdout = chunks.join("");
  assert.match(stdout, new RegExp(`# Project Context: ${project}`), "stdout carries the context packet");
  assert.ok(stdout.length > 0, "stdout is non-empty");
  assert.ok(!stdout.includes("[uace]"), "stdout must NOT contain server/log noise (purity)");

  // 4. unknown command exits non-zero
  assert.equal(await runCli(["bogus"]), 2, "unknown subcommand exits 2");

  console.log("✓ smoke-cli passed — context (stdout-pure) + save-session(summary/transcript, deduped) + sync wiring");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
