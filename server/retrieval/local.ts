import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as pipe } from "node:stream/promises";
import { AppError } from "../errors.ts";
import type { LocalSize } from "../settings.ts";

// Local embedding models (F-1005): run on this computer through ONNX, free after a one-time download.
// Nothing is downloaded unless the learner agreed to the size shown. Distil fetches the files itself into
// the data folder and the model loads only from there, never from the network.
//
// The graphics card runs half-precision (fp16) models through DirectML on Windows, the only GPU support
// the bundled ONNX runtime has without extra installs; there the fp16 file is downloaded, run on the GPU,
// and run on the processor if the GPU can't start. Elsewhere the smaller 8-bit file runs on the processor.
export const LOCAL_MODELS: Record<LocalSize, { repo: string; label: string; pooling: "mean" | "cls"; note: string }> = {
  low: { repo: "Xenova/all-MiniLM-L6-v2", label: "Low", pooling: "mean", note: "Smallest and fastest, English" },
  medium: { repo: "Xenova/bge-base-en-v1.5", label: "Medium", pooling: "cls", note: "Better matches, English" },
  high: { repo: "Xenova/bge-m3", label: "High", pooling: "cls", note: "Best matches, many languages" },
};
export type Device = "gpu" | "cpu";
type Variant = { dtype: "fp16" | "q8"; file: string; devices: ("dml" | "cpu")[] };
const VARIANTS: Record<"gpu" | "cpu", Variant> = {
  gpu: { dtype: "fp16", file: "onnx/model_fp16.onnx", devices: ["dml", "cpu"] },
  cpu: { dtype: "q8", file: "onnx/model_quantized.onnx", devices: ["cpu"] },
};
// The tokenizer and configs every variant needs (those the repo has).
const SIDE_FILES = ["tokenizer.json", "tokenizer_config.json", "config.json", "special_tokens_map.json"];
const HUB = "https://huggingface.co";

type Extractor = (texts: string[], o: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export function createLocalModels(dir: string, fetchImpl: typeof fetch = fetch, platform: NodeJS.Platform = process.platform) {
  const variant = VARIANTS[platform === "win32" ? "gpu" : "cpu"];
  const loaded = new Map<LocalSize, Promise<Extractor>>();
  // Where each loaded model actually runs, once known.
  const running = new Map<LocalSize, Device>();
  const folder = (size: LocalSize) => join(dir, ...LOCAL_MODELS[size].repo.split("/"));
  // The variant on disk: this computer's own, or the other one from an earlier download (an 8-bit model
  // downloaded before the GPU version existed still runs, on the processor).
  const onDisk = (size: LocalSize): Variant | null =>
    [variant, ...Object.values(VARIANTS).filter((v) => v !== variant)].find((v) => existsSync(join(folder(size), ...v.file.split("/")))) ?? null;
  const installed = (size: LocalSize) => onDisk(size) !== null;

  // The repo's files this model needs, with their sizes.
  async function files(size: LocalSize): Promise<{ path: string; bytes: number }[]> {
    const res = await fetchImpl(`${HUB}/api/models/${LOCAL_MODELS[size].repo}/tree/main?recursive=true`).catch(() => null);
    if (!res?.ok) throw new AppError(502, "size_unknown", "Couldn't reach Hugging Face to check the download.");
    const all = (await res.json()) as { path: string; size?: number; lfs?: { size: number } }[];
    const wanted = all.filter((f) => f.path === variant.file || SIDE_FILES.includes(f.path)).map((f) => ({ path: f.path, bytes: f.lfs?.size ?? f.size ?? 0 }));
    if (!wanted.some((f) => f.path === variant.file)) throw new AppError(502, "model_unavailable", "That model's files aren't on Hugging Face any more.");
    return wanted;
  }

  async function load(size: LocalSize, log?: (msg: string) => void): Promise<Extractor> {
    const found = onDisk(size);
    if (!found) throw new AppError(409, "model_missing", `The ${LOCAL_MODELS[size].label} search model isn't downloaded. Download it in Settings › Models.`);
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.localModelPath = dir;
    let last: unknown;
    for (const device of found.devices) {
      try {
        const extractor = await pipeline("feature-extraction", LOCAL_MODELS[size].repo, {
          dtype: found.dtype, device, local_files_only: true,
          // ONNX Runtime warns about every op it keeps on the CPU; only errors are worth printing.
          session_options: { logSeverityLevel: 3 },
        }) as unknown as Extractor;
        // A GPU that can't run the model sometimes fails only on the first run, so it runs once here.
        await extractor(["warm up"], { pooling: LOCAL_MODELS[size].pooling, normalize: true });
        running.set(size, device === "cpu" ? "cpu" : "gpu");
        return extractor;
      } catch (err) {
        last = err;
        log?.(`The ${LOCAL_MODELS[size].label} search model couldn't run on ${device === "cpu" ? "the processor" : "the graphics card"}: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw last;
  }

  return {
    installed,
    // Where the model runs once loaded: the graphics card, or the processor; null until it has run.
    device: (size: LocalSize): Device | null => running.get(size) ?? null,
    // Whether this computer's downloads are the GPU variant.
    usesGpu: variant.dtype === "fp16",
    // The exact download size, asked of Hugging Face before the learner agrees to it.
    async size(size: LocalSize): Promise<number> {
      return (await files(size)).reduce((n, f) => n + f.bytes, 0);
    },
    // Fetches each file to a .part file and renames it when complete, the model file last, so a stopped
    // download never looks installed. Files from another variant are removed first.
    async download(size: LocalSize, onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
      const list = (await files(size)).sort((a, b) => Number(a.path === variant.file) - Number(b.path === variant.file));
      for (const other of Object.values(VARIANTS)) if (other.file !== variant.file) rmSync(join(folder(size), ...other.file.split("/")), { force: true });
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
      running.delete(size);
    },
    remove(size: LocalSize) {
      loaded.delete(size);
      running.delete(size);
      rmSync(folder(size), { recursive: true, force: true });
    },
    async embed(size: LocalSize, texts: string[], log?: (msg: string) => void): Promise<number[][]> {
      if (!loaded.has(size)) loaded.set(size, load(size, log).catch((err) => { loaded.delete(size); throw err; }));
      const extract = await loaded.get(size)!;
      return (await extract(texts, { pooling: LOCAL_MODELS[size].pooling, normalize: true })).tolist();
    },
  };
}

export type LocalModels = ReturnType<typeof createLocalModels>;
