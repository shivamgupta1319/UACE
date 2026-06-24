/**
 * Local, CPU-only text embeddings for semantic memory search.
 *
 * The default backend uses Transformers.js (`all-MiniLM-L6-v2`, 384-dim) which
 * runs fully offline after a one-time model download. Everything is designed to
 * degrade gracefully: if the model can't load (e.g. offline first-run), `embed`
 * returns null and the engine falls back to FTS keyword search.
 */
export interface Embedder {
  readonly name: string;
  readonly dim: number;
  /** Returns a normalized vector, or null if embeddings are unavailable. */
  embed(text: string): Promise<number[] | null>;
  /** Whether the backend is usable (attempts lazy load on first call). */
  ready(): Promise<boolean>;
}

const DEFAULT_MODEL = process.env.UACE_EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIM = Number(process.env.UACE_EMBED_DIM ?? 384);

export class TransformersEmbedder implements Embedder {
  readonly name: string;
  readonly dim: number;
  private extractor: unknown = null;
  private failed = false;
  private loadPromise: Promise<boolean> | null = null;

  constructor(model = DEFAULT_MODEL, dim = DEFAULT_DIM) {
    this.name = model;
    this.dim = dim;
  }

  async ready(): Promise<boolean> {
    if (this.extractor) return true;
    if (this.failed) return false;
    if (!this.loadPromise) this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<boolean> {
    try {
      // Imported lazily so server startup isn't blocked by the heavy library.
      const { pipeline } = await import("@huggingface/transformers");
      this.extractor = await pipeline("feature-extraction", this.name);
      console.error(`[uace] embedder ready: ${this.name} (${this.dim}d)`);
      return true;
    } catch (err) {
      this.failed = true;
      console.error(
        `[uace] embedder unavailable (${(err as Error).message}); falling back to keyword search.`
      );
      return false;
    }
  }

  async embed(text: string): Promise<number[] | null> {
    if (!(await this.ready())) return null;
    const extract = this.extractor as (
      t: string,
      o: Record<string, unknown>
    ) => Promise<{ data: Float32Array | number[] }>;
    const out = await extract(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  }
}

/** Build the default embedder, honoring UACE_NO_EMBED=1 to disable embeddings. */
export function createEmbedder(): Embedder | null {
  if (process.env.UACE_NO_EMBED === "1") return null;
  return new TransformersEmbedder();
}
