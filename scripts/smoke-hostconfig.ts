/**
 * Unit test for the pure host-config helpers (extension/src/hostConfig.ts).
 * Asserts non-destructive merges, idempotency, and clean removal — the safety
 * guarantees for writing into users' repos and host config files.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertMcpServer,
  removeMcpServer,
  npxServer,
  upsertBlock,
  stripBlock,
  writeRulesMarkdown,
  mergeJsonFile,
  writeClaudeHooks,
  removeClaudeHooks,
  UACE_RULES_BODY,
} from "../extension/src/hostConfig.js";

const dir = mkdtempSync(join(tmpdir(), "uace-hostcfg-"));

try {
  // T3 — upsertMcpServer preserves other servers + extra keys (e.g. Antigravity $typeName).
  const cfg = join(dir, "mcp_config.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      mcpServers: {
        github: { command: "gh", args: ["mcp"], env: { TOKEN: "secret" } },
        uace: { $typeName: "x.Server", command: "old", args: [] },
      },
    })
  );
  upsertMcpServer(cfg, npxServer());
  let parsed = JSON.parse(readFileSync(cfg, "utf8"));
  assert.equal(parsed.mcpServers.github.env.TOKEN, "secret", "other server's secret preserved");
  assert.equal(parsed.mcpServers.uace.command, "npx", "uace command updated");
  assert.deepEqual(parsed.mcpServers.uace.args, ["-y", "uace-mcp"], "uace args updated");
  assert.equal(parsed.mcpServers.uace.$typeName, "x.Server", "Antigravity $typeName on uace preserved");

  // removeMcpServer removes ONLY uace.
  assert.equal(removeMcpServer(cfg), true, "removeMcpServer reports removal");
  parsed = JSON.parse(readFileSync(cfg, "utf8"));
  assert.ok(parsed.mcpServers.github, "other server still present after removal");
  assert.ok(!("uace" in parsed.mcpServers), "uace removed");

  // T6 — malformed JSON is left untouched (throws, no clobber).
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.throws(() => mergeJsonFile(bad, () => {}), /not valid JSON/, "malformed JSON throws");
  assert.equal(readFileSync(bad, "utf8"), "{ not json", "malformed file untouched");

  // T4 — rules block-merge is idempotent and preserves surrounding content.
  const agents = join(dir, "AGENTS.md");
  writeFileSync(agents, "# My Project\n\nExisting house rules.\n");
  writeRulesMarkdown(agents);
  const once = readFileSync(agents, "utf8");
  writeRulesMarkdown(agents);
  const twice = readFileSync(agents, "utf8");
  assert.equal(once, twice, "writeRulesMarkdown is idempotent");
  assert.match(once, /Existing house rules\./, "user content preserved");
  assert.match(once, /mcp__uace__get_project_context/, "UACE block written");

  // T5 — stripBlock removes only the UACE block.
  const stripped = stripBlock(once);
  assert.match(stripped, /Existing house rules\./, "user content kept after strip");
  assert.ok(!stripped.includes("mcp__uace__"), "UACE block removed");
  assert.ok(!stripped.includes("BEGIN UACE"), "no stray markers");

  // upsertBlock on empty input creates just the block.
  assert.match(upsertBlock("", UACE_RULES_BODY), /BEGIN UACE[\s\S]*END UACE/, "empty → block only");

  // Claude hooks: scripts written + settings merged idempotently; removal cleans up.
  const ws = join(dir, "proj");
  writeClaudeHooks(ws, "proj");
  const settings = join(ws, ".claude", "settings.json");
  assert.ok(existsSync(join(ws, ".claude", "hooks", "uace-recall.sh")), "recall hook written");
  assert.ok(existsSync(join(ws, ".claude", "hooks", "uace-save.sh")), "save hook written");
  const s1 = readFileSync(settings, "utf8");
  writeClaudeHooks(ws, "proj");
  const s2 = readFileSync(settings, "utf8");
  assert.equal(s1, s2, "writeClaudeHooks idempotent (no duplicate hook entries)");
  const sObj = JSON.parse(s2);
  assert.equal(sObj.hooks.SessionStart.length, 1, "exactly one SessionStart entry");
  removeClaudeHooks(ws);
  const sAfter = JSON.parse(readFileSync(settings, "utf8"));
  assert.ok(!sAfter.hooks?.SessionStart, "SessionStart removed on teardown");

  console.log("✓ smoke-hostconfig passed — mcp merge (preserve $typeName/secrets) + rules idempotency + strip + hooks");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
