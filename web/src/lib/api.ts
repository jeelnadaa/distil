// Typed client for the local API. Types come straight from the server modules.
import type { Meter, TurnEvent } from "../../../server/chat.ts";
import type { Chat, Folder } from "../../../server/library.ts";
import type { FontInfo } from "../../../server/fonts.ts";
import type { Job } from "../../../server/jobs.ts";
import type { estimateExtraction, Strategy } from "../../../server/ledger/extract.ts";
import type { Item, ItemMark, ItemType } from "../../../server/ledger/store.ts";
import type { Material, StoredChunk } from "../../../server/materials/store.ts";
import type { Message } from "../../../server/messages.ts";
import type { ProviderSpec } from "../../../server/providers/catalog.ts";
import type { ModelInfo } from "../../../server/providers/types.ts";
import type { ModelRef, Settings } from "../../../server/settings.ts";
import type { CapStatus } from "../../../server/usage.ts";

export type { CapStatus, Chat, FontInfo, Folder, Item, ItemMark, ItemType, Job, Message, Meter, ModelInfo, ModelRef, Settings, Strategy, TurnEvent };
export type FolderMaterial = Material & { inherited: boolean };
export type { Material, StoredChunk };
export type Estimate = ReturnType<typeof estimateExtraction> & { materials: number };
// What a Distil run covers: a whole folder, or one material, optionally only a location range of it.
export type DistilScope = { strategy: Strategy; materialId?: string; from?: number; to?: number };
export type Provider = ProviderSpec & { configured: boolean; keyPreview: string | null };
export type SettingsView = Settings & { dataDir: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal, file?: File): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: file ? { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }
        : body === undefined ? undefined : { "content-type": "application/json" },
      body: file ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, "offline", "Can't reach Distil's local server. Is it still running?");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new ApiError(res.status, error.code ?? "unknown", error.message ?? `Request failed (${res.status}).`, error.details);
  }
  return res;
}

const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => (await call(method, path, body)).json();

// For calls with no response body: resolves to true, so attempt() can tell success from failure.
const done = async (method: string, path: string): Promise<true> => {
  await call(method, path);
  return true;
};

export const api = {
  library: () => json<{ folders: Folder[]; chats: Chat[] }>("GET", "/library"),
  createFolder: (name: string, parentId: string | null) => json<Folder>("POST", "/folders", { name, parentId }),
  updateFolder: (id: string, patch: { name?: string; parentId?: string | null }) => json<Folder>("PATCH", `/folders/${id}`, patch),
  folderContents: (id: string) => json<{ folders: number; chats: number }>("GET", `/folders/${id}/contents`),
  deleteFolder: (id: string) => done("DELETE", `/folders/${id}`),

  createChat: (folderId: string | null) => json<Chat>("POST", "/chats", { folderId }),
  chat: (id: string) => json<{ chat: Chat; messages: Message[]; meter: Meter }>("GET", `/chats/${id}`),
  updateChat: (id: string, patch: { title?: string; folderId?: string | null; model?: ModelRef | null }) => json<Chat>("PATCH", `/chats/${id}`, patch),
  deleteChat: (id: string) => done("DELETE", `/chats/${id}`),

  providers: () => json<Provider[]>("GET", "/providers"),
  models: (provider: string, refresh = false) => json<ModelInfo[]>("GET", `/providers/${provider}/models${refresh ? "?refresh=1" : ""}`),
  setKey: (provider: string, key: string) => json<{ models: number }>("PUT", `/providers/${provider}/key`, { key }),
  removeKey: (provider: string) => done("DELETE", `/providers/${provider}/key`),

  settings: () => json<SettingsView>("GET", "/settings"),
  updateSettings: (patch: Partial<Settings>) => json<SettingsView>("PATCH", "/settings", patch),
  fontInfo: () => json<FontInfo | null>("GET", "/fonts/text/info"),
  uploadFont: (name: string, data: string) => json<FontInfo>("PUT", "/fonts/text", { name, data }),
  removeFont: () => done("DELETE", "/fonts/text"),

  materials: (folderId: string) => json<FolderMaterial[]>("GET", `/folders/${folderId}/materials`),
  uploadMaterial: async (folderId: string, file: File): Promise<FolderMaterial> =>
    (await call("POST", `/folders/${folderId}/materials`, undefined, undefined, file)).json(),
  addLink: (folderId: string, url: string, transcript?: string) => json<FolderMaterial>("POST", `/folders/${folderId}/materials/url`, { url, transcript }),
  material: (id: string) => json<{ material: Material; chunks: StoredChunk[] }>("GET", `/materials/${id}`),
  deleteMaterial: (id: string) => done("DELETE", `/materials/${id}`),
  replaceMaterial: async (id: string, file: File): Promise<Material> =>
    (await call("POST", `/materials/${id}/replace`, undefined, undefined, file)).json(),
  refetchMaterial: (id: string) => json<Material>("POST", `/materials/${id}/refetch`, {}),
  dismissReimport: (id: string) => done("DELETE", `/materials/${id}/reimport`),
  estimate: (folderId: string, scope: DistilScope, reaudit = false) => {
    const query = new URLSearchParams(Object.entries(scope).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    if (reaudit) query.set("reaudit", "1");
    return json<Estimate>("GET", `/folders/${folderId}/estimate?${query}`);
  },
  extract: (folderId: string, scope: DistilScope) => json<Job[]>("POST", `/folders/${folderId}/extract`, scope),
  reaudit: (folderId: string, strategy: Strategy) => json<Job[]>("POST", `/folders/${folderId}/reaudit`, { strategy }),
  items: (folderId: string) => json<Item[]>("GET", `/folders/${folderId}/items`),
  addItem: (folderId: string, item: { type: ItemType; title: string; statement: string }) => json<Item>("POST", `/folders/${folderId}/items`, item),
  updateItem: (id: string, patch: { title?: string; statement?: string; type?: ItemType; mark?: ItemMark | null }) => json<Item>("PATCH", `/items/${id}`, patch),
  deleteItem: (id: string) => done("DELETE", `/items/${id}`),
  jobs: () => json<Job[]>("GET", "/jobs"),
  abortJob: (id: string) => json<Job>("POST", `/jobs/${id}/abort`),

  usage: () => json<{ today: number; month: number; cap: CapStatus }>("GET", "/usage"),

  // Sends a message and calls onEvent for each streamed event until the turn ends or is aborted.
  async send(chatId: string, text: string, model: ModelRef | undefined, onEvent: (e: TurnEvent) => void, signal: AbortSignal) {
    const res = await call("POST", `/chats/${chatId}/messages`, { text, model }, signal);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (data) onEvent(JSON.parse(data));
      }
    }
  },
};
