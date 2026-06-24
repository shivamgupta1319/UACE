import chokidar, { type FSWatcher } from "chokidar";
import { relative } from "node:path";

export type FileEventKind = "add" | "change" | "unlink";
export interface FileEvent {
  path: string; // relative to the watched root
  event: FileEventKind;
}

const IGNORED = /(^|[/\\])(\.git|node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv|target)([/\\]|$)/;

/**
 * Watches project directories for live file activity and forwards debounced
 * create/modify/delete events. This captures *uncommitted* work-in-progress —
 * the signal git history can't give you. Watchers live for the duration of the
 * MCP server process; events are persisted by the caller so they survive it.
 */
export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();

  /** Currently watched project names. */
  active(): string[] {
    return [...this.watchers.keys()];
  }

  isWatching(project: string): boolean {
    return this.watchers.has(project);
  }

  /**
   * Start watching `root` under the id `project`. `onEvent` fires per change.
   * Returns false if already watching this project.
   */
  watch(project: string, root: string, onEvent: (e: FileEvent) => void): boolean {
    if (this.watchers.has(project)) return false;

    const watcher = chokidar.watch(root, {
      ignored: IGNORED,
      ignoreInitial: true, // don't flood with the existing tree on startup
      persistent: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const emit = (event: FileEventKind) => (full: string) => {
      const rel = relative(root, full) || full;
      onEvent({ path: rel, event });
    };
    watcher
      .on("add", emit("add"))
      .on("change", emit("change"))
      .on("unlink", emit("unlink"));

    this.watchers.set(project, watcher);
    return true;
  }

  async unwatch(project: string): Promise<boolean> {
    const w = this.watchers.get(project);
    if (!w) return false;
    await w.close();
    this.watchers.delete(project);
    return true;
  }

  /** Tear down all watchers (call on server shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.close()));
    this.watchers.clear();
  }
}
