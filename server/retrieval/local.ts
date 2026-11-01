import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "../errors.ts";
import type { LocalSize } from "../settings.ts";

// Local embedding models (F-1005): run on this computer through ONNX, free after a one-time download.
// Nothing is downloaded unless the learner agreed to the size shown; until then only files already on
// disk are used.
export const LOCAL_MODELS: Record<LocalSize, { repo: string; label: string; pooling: "mean" | "cls"; note: string }> = {
  small: { repo: "Xenova/all-MiniLM-L6-v2", label: "Small", pooling: "mean", note: "Fast, English" },
  medium: { repo: "Xenova/bge-base-en-v1.5", label: "Medium", pooling: "cls", note: "Better matches, English" },
  high: { repo: "Xenova/bge-m3", label: "High", pooling: "cls", note: "Best matches, many languages" },
};
const DTYPE = "q8";
// The files a download fetches: the quantised model, its tokenizer and configs.
const FILES = ["onnx/model_quantized.onnx", "tokenizer.json", "tokenizer_config.json", "config.json", "special_tokens_map.json"];

type Extractor = (texts: string[], o: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export function createLocalModels(dir: string, fetchImpl: typeof fetch = fetch) {
  const loaded = new Map<LocalSize, Promise<Extractor>>();
  const folder = (size: LocalSize) => join(dir, ...LOCAL_MODELS[size].repo.split("/"));

  async function load(size: LocalSize, download = false, onProgress?: (done: number, total: number) => void): Promise<Extractor> {
    if (!download && !installed(size)) throw new AppError(409, "model_missing", `The ${LOCAL_MODELS[size].label} search model isn't downloaded. Download it in Settings › Models.`);
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = dir;
    env.allowRemoteModels = download;
    const totals = new Map<string, [number, number]>();
    return pipeline("feature-extraction", LOCAL_MODELS[size].repo, {
      dtype: DTYPE, cache_dir: dir, local_files_only: !download,
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !onProgress) return;
        totals.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
        const sum = [...totals.values()].reduce((a, [l, t]) => [a[0] + l, a[1] + t], [0, 0]);
        onProgress(sum[0], sum[1]);
      },
    }) as unknown as Promise<Extractor>;
  }

  const installed = (size: LocalSize) => existsSync(join(folder(size), "onnx", "model_quantized.onnx"));

  return {
    installed,
    // The exact download size, asked of Hugging Face before the learner agrees to it.
    async size(size: LocalSize): Promise<number> {
      const res = await fetchImpl(`https://huggingface.co/api/models/${LOCAL_MODELS[size].repo}/tree/main?recursive=true`);
      if (!res.ok) throw new AppError(502, "size_unknown", "Couldn't reach Hugging Face to check the download size.");
      const files = (await res.json()) as { path: string; size?: number; lfs?: { size: number } }[];
      return files.filter((f) => FILES.includes(f.path)).reduce((n, f) => n + (f.lfs?.size ?? f.size ?? 0), 0);
    },
    async download(size: LocalSize, onProgress: (done: number, total: number) => void) {
      const extractor = await load(size, true, onProgress);
      loaded.set(size, Promise.resolve(extractor));
    },
    remove(size: LocalSize) {
      loaded.delete(size);
      rmSync(folder(size), { recursive: true, force: true });
    },
    async embed(size: LocalSize, texts: string[]): Promise<number[][]> {
      if (!loaded.has(size)) loaded.set(size, load(size).catch((err) => { loaded.delete(size); throw err; }));
      const extract = await loaded.get(size)!;
      return (await extract(texts, { pooling: LOCAL_MODELS[size].pooling, normalize: true })).tolist();
    },
  };
}

export type LocalModels = ReturnType<typeof createLocalModels>;
