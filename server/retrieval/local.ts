import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as pipe } from "node:stream/promises";
import { AppError } from "../errors.ts";
import type { LocalSize } from "../settings.ts";

// Local embedding models (F-1005): run on this computer through ONNX, free after a one-time download.
// Nothing is downloaded unless the learner agreed to the size shown. Distil fetches the files itself into
// the data folder and the model loads only from there, never from the network.
export const LOCAL_MODELS: Record<LocalSize, { repo: string; label: string; pooling: "mean" | "cls"; note: string }> = {
  low: { repo: "Xenova/all-MiniLM-L6-v2", label: "Low", pooling: "mean", note: "Smallest and fastest, English" },
  medium: { repo: "Xenova/bge-base-en-v1.5", label: "Medium", pooling: "cls", note: "Better matches, English" },
  high: { repo: "Xenova/bge-m3", label: "High", pooling: "cls", note: "Best matches, many languages" },
};
const DTYPE = "q8";
// The files a model needs: the quantised model, its tokenizer and configs (those the repo has).
const FILES = ["onnx/model_quantized.onnx", "tokenizer.json", "tokenizer_config.json", "config.json", "special_tokens_map.json"];
const MODEL_FILE = FILES[0]!;
const HUB = "https://huggingface.co";

type Extractor = (texts: string[], o: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export function createLocalModels(dir: string, fetchImpl: typeof fetch = fetch) {
  const loaded = new Map<LocalSize, Promise<Extractor>>();
  const folder = (size: LocalSize) => join(dir, ...LOCAL_MODELS[size].repo.split("/"));
  const installed = (size: LocalSize) => existsSync(join(folder(size), MODEL_FILE));

  // The repo's files this model needs, with their sizes.
  async function files(size: LocalSize): Promise<{ path: string; bytes: number }[]> {
    const res = await fetchImpl(`${HUB}/api/models/${LOCAL_MODELS[size].repo}/tree/main?recursive=true`).catch(() => null);
    if (!res?.ok) throw new AppError(502, "size_unknown", "Couldn't reach Hugging Face to check the download.");
    const all = (await res.json()) as { path: string; size?: number; lfs?: { size: number } }[];
    const wanted = all.filter((f) => FILES.includes(f.path)).map((f) => ({ path: f.path, bytes: f.lfs?.size ?? f.size ?? 0 }));
    if (!wanted.some((f) => f.path === MODEL_FILE)) throw new AppError(502, "model_unavailable", "That model's files aren't on Hugging Face any more.");
    return wanted;
  }

  async function load(size: LocalSize): Promise<Extractor> {
    if (!installed(size)) throw new AppError(409, "model_missing", `The ${LOCAL_MODELS[size].label} search model isn't downloaded. Download it in Settings › Models.`);
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.localModelPath = dir;
    return pipeline("feature-extraction", LOCAL_MODELS[size].repo, { dtype: DTYPE, local_files_only: true }) as unknown as Promise<Extractor>;
  }

  return {
    installed,
    // The exact download size, asked of Hugging Face before the learner agrees to it.
    async size(size: LocalSize): Promise<number> {
      return (await files(size)).reduce((n, f) => n + f.bytes, 0);
    },
    // Fetches each file to a .part file and renames it when complete, the model file last, so a stopped
    // download never looks installed.
    async download(size: LocalSize, onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
      const list = (await files(size)).sort((a, b) => Number(a.path === MODEL_FILE) - Number(b.path === MODEL_FILE));
      const total = list.reduce((n, f) => n + f.bytes, 0);
      let done = 0;
      for (const f of list) {
        const target = join(folder(size), ...f.path.split("/"));
        const part = `${target}.part`;
        mkdirSync(dirname(target), { recursive: true });
        const res = await fetchImpl(`${HUB}/${LOCAL_MODELS[size].repo}/resolve/main/${f.path}`, { signal });
        if (!res.ok || !res.body) throw new AppError(502, "download_failed", `Downloading ${f.path} failed (${res.status}).`);
        const count = new Transform({ transform(chunk: Buffer, _enc, next) { done += chunk.length; onProgress(done, total); next(null, chunk); } });
        try {
          await pipe(Readable.fromWeb(res.body as never), count, createWriteStream(part), { signal });
        } catch (err) {
          rmSync(part, { force: true });
          throw err;
        }
        renameSync(part, target);
      }
      loaded.delete(size);
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
