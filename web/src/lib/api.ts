// Typed client for the local API. Types come straight from the server modules.
import type { Meter, TurnEvent } from "../../../server/chat.ts";
import type { Chat, Folder } from "../../../server/library.ts";
import type { SavedFont } from "../../../server/fonts.ts";
import type { Job } from "../../../server/jobs.ts";
import type { estimateExtraction, Strategy } from "../../../server/ledger/extract.ts";
import type { Item, ItemMark, ItemType } from "../../../server/ledger/store.ts";
import type { Material, StoredChunk } from "../../../server/materials/store.ts";
import type { Message, Source } from "../../../server/messages.ts";
import type { ProviderSpec } from "../../../server/providers/catalog.ts";
import type { ModelInfo } from "../../../server/providers/types.ts";
import type { Brief } from "../../../server/learning/types.ts";
import type { Compiled, StoredBrief } from "../../../server/plan/brief.ts";
import type { Lesson, Plan, PlanKind, SavedPlan, Unit } from "../../../server/plan/store.ts";
import type { TodayLesson, TodayView } from "../../../server/plan/today.ts";
import type { PlanView } from "../../../server/plan/view.ts";
import type { LocalSize, ModelRef, Settings } from "../../../server/settings.ts";
import type { CapStatus } from "../../../server/usage.ts";
import type { Confidence, PublicCheck, Result } from "../../../server/teach/checks.ts";
import type { ActionKind, Answer, SessionView, TeachEvent } from "../../../server/teach/engine.ts";
import type { CheckView, Step } from "../../../server/teach/store.ts";
import type { Visual } from "../../../server/visuals/builder.ts";
import type { Dial } from "../../../server/visuals/reference.ts";

export type { Brief, Compiled, Lesson, Plan, PlanKind, PlanView, SavedPlan, StoredBrief, TodayLesson, TodayView, Unit };
export type { CapStatus, Chat, SavedFont, Folder, Item, ItemMark, ItemType, Job, Message, Meter, ModelInfo, ModelRef, Settings, Strategy, TurnEvent };
export type { ActionKind, Answer, CheckView, Confidence, PublicCheck, Result, SessionView, Source, Step, TeachEvent };
export type { Dial, Visual };
export type TeachView = { session: SessionView | null; checks: CheckView[] };
export type FolderMaterial = Material & { inherited: boolean };
export type { Material, StoredChunk };
export type Estimate = ReturnType<typeof estimateExtraction> & { materials: number };
// What a Distil run covers: a whole folder, or one material, optionally only a location range of it.
export type DistilScope = { strategy: Strategy; materialId?: string; from?: number; to?: number };
// A lesson with where it sits in its plan and its unit, as a lesson chat shows it.
export type LessonDetail = {
  lesson: Lesson; folderId: string; unit: Unit; unitNo: number; unitLessons: { done: number; total: number };
  index: number; total: number; items: Item[];
};
// Search by meaning (F-1005): the local models and how far indexing has got for the chosen model.
export type EmbeddingsView = {
  local: { size: LocalSize; label: string; note: string; installed: boolean; device: "gpu" | "cpu" | null }[];
  // Whether local models are downloaded in the version that runs on the graphics card.
  gpu: boolean;
  index: { done: number; total: number } | null;
};
export type ProviderKey = { id: string; label: string; preview: string };
export type Provider = ProviderSpec & { configured: boolean; keys: ProviderKey[] };
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

// The learner's local day (YYYY-MM-DD), which the plan's schedule is counted in.
export const localDay = (at = new Date()) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => (await call(method, path, body)).json();

// For calls with no response body: resolves to true, so attempt() can tell success from failure.
const done = async (method: string, path: string): Promise<true> => {
  await call(method, path);
  return true;
};

export const api = {
  library: () => json<{ folders: Folder[]; chats: Chat[] }>("GET", "/library"),
  createFolder: (name: string, parentId: string | null) => json<Folder>("POST", "/folders", { name, parentId }),
  updateFolder: (id: string, patch: { name?: string; parentId?: string | null; dial?: Dial | null }) => json<Folder>("PATCH", `/folders/${id}`, patch),
  folderContents: (id: string) => json<{ folders: number; chats: number }>("GET", `/folders/${id}/contents`),
  deleteFolder: (id: string) => done("DELETE", `/folders/${id}`),

  createChat: (folderId: string | null) => json<Chat>("POST", "/chats", { folderId }),
  chat: (id: string) => json<{ chat: Chat; messages: Message[]; meter: Meter }>("GET", `/chats/${id}`),
  updateChat: (id: string, patch: { title?: string; folderId?: string | null; model?: ModelRef | null; dial?: Dial | null }) => json<Chat>("PATCH", `/chats/${id}`, patch),
  deleteChat: (id: string) => done("DELETE", `/chats/${id}`),

  providers: () => json<Provider[]>("GET", "/providers"),
  models: (provider: string, refresh = false) => json<ModelInfo[]>("GET", `/providers/${provider}/models${refresh ? "?refresh=1" : ""}`),
  addKey: (provider: string, key: string, label?: string) => json<{ models: number; key: ProviderKey }>("POST", `/providers/${provider}/keys`, { key, label }),
  // Without keyId, every key of the provider.
  removeKey: (provider: string, keyId?: string) => done("DELETE", `/providers/${provider}/keys${keyId ? `/${keyId}` : ""}`),

  embeddings: () => json<EmbeddingsView>("GET", "/embeddings"),
  embeddingModels: (provider: string) => json<ModelInfo[]>("GET", `/providers/${provider}/embedding-models`),
  localModelSize: (size: string) => json<{ bytes: number }>("GET", `/embeddings/local/${size}`),
  downloadLocalModel: (size: string) => json<Job>("POST", `/embeddings/local/${size}/download`, {}),
  removeLocalModel: (size: string) => done("DELETE", `/embeddings/local/${size}`),
  indexNow: () => json<{ queued: boolean }>("POST", "/embeddings/index", {}),
  settings: () => json<SettingsView>("GET", "/settings"),
  updateSettings: (patch: Partial<Settings>) => json<SettingsView>("PATCH", "/settings", patch),
  fonts: () => json<SavedFont[]>("GET", "/fonts"),
  addFont: (font: { family: string; name?: string } | { fileName: string; data: string; name?: string }) => json<SavedFont>("POST", "/fonts", font),
  renameFont: (id: string, name: string) => json<SavedFont>("PATCH", `/fonts/${id}`, { name }),
  removeFont: (id: string) => done("DELETE", `/fonts/${id}`),

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

  // Study Plan (Phase 3). Dates are the learner's local day.
  brief: (folderId: string) => json<StoredBrief | null>("GET", `/folders/${folderId}/brief`),
  compileBrief: (folderId: string, request: string) => json<Compiled>("POST", `/folders/${folderId}/brief/compile?today=${localDay()}`, { request }),
  saveBrief: (folderId: string, brief: Brief, kind: PlanKind) => json<StoredBrief>("PUT", `/folders/${folderId}/brief`, { brief, kind }),
  plan: (folderId: string) => json<PlanView>("GET", `/folders/${folderId}/plan?today=${localDay()}`),
  // replace: the saved plan the new one replaces; from: a saved plan whose brief to reuse; brief: a new brief.
  buildPlan: (folderId: string, body: { replace?: string; from?: string; brief?: { brief: Brief; kind: PlanKind } } = {}) =>
    json<Job>("POST", `/folders/${folderId}/plan`, body),
  activatePlan: (folderId: string, planId: string) => json<PlanView>("POST", `/folders/${folderId}/plans/${planId}/activate?today=${localDay()}`, {}),
  deletePlan: (folderId: string, planId: string) => json<PlanView>("DELETE", `/folders/${folderId}/plans/${planId}?today=${localDay()}`),
  extendPlan: (folderId: string) => json<Job>("POST", `/folders/${folderId}/plan/extend`, {}),
  setBufferDays: (folderId: string, bufferDays: number) => json<PlanView>("PATCH", `/folders/${folderId}/plan?today=${localDay()}`, { bufferDays }),
  exportUrl: (folderId: string, format: "md" | "ics") => `/api/folders/${folderId}/plan/export.${format}?today=${localDay()}`,
  updateLesson: (id: string, patch: { title?: string; minutes?: number; status?: Lesson["status"]; move?: { unitId: string; index: number } }) =>
    json<PlanView>("PATCH", `/lessons/${id}?today=${localDay()}`, patch),
  splitLesson: (id: string, at: number) => json<PlanView>("POST", `/lessons/${id}/split?today=${localDay()}`, { at }),
  mergeLesson: (id: string) => json<PlanView>("POST", `/lessons/${id}/merge?today=${localDay()}`, {}),
  knowLesson: (id: string) => json<PlanView>("POST", `/lessons/${id}/known?today=${localDay()}`, {}),
  lesson: (id: string) => json<LessonDetail>("GET", `/lessons/${id}`),
  startLesson: (id: string) => json<Chat>("POST", `/lessons/${id}/start`, {}),
  today: () => json<TodayView>("GET", `/today?today=${localDay()}`),

  usage: () => json<{ today: number; month: number; cap: CapStatus }>("GET", "/usage"),

  // Sends a message and calls onEvent for each streamed event until the turn ends or is aborted.
  send: (chatId: string, text: string, model: ModelRef | undefined, onEvent: (e: TurnEvent) => void, signal: AbortSignal) =>
    events(`/chats/${chatId}/messages`, { text, model }, onEvent, signal),

  // A lesson (Phase 4): its session, and each move in it streamed.
  teach: (chatId: string) => json<TeachView>("GET", `/chats/${chatId}/teach`),
  visuals: (messageId: string) => json<Visual[]>("GET", `/messages/${messageId}/visuals`),
  buildVisual: (messageId: string, block: number, rebuild = false) => json<Visual>("POST", `/messages/${messageId}/visuals`, { block, rebuild }),
  fixVisual: (id: string, errors: string[]) => json<Visual>("POST", `/visuals/${id}/fix`, { errors }),
  repairMessage: (messageId: string) => json<Message>("POST", `/messages/${messageId}/repair`, {}),
  teachStart: (chatId: string, onEvent: (e: TeachEvent) => void, signal: AbortSignal) => events(`/chats/${chatId}/teach/start`, {}, onEvent, signal),
  teachAnswer: (chatId: string, answer: Answer, onEvent: (e: TeachEvent) => void, signal: AbortSignal) => events(`/chats/${chatId}/teach/answer`, answer, onEvent, signal),
  teachAction: (chatId: string, kind: ActionKind, onEvent: (e: TeachEvent) => void, signal: AbortSignal) => events(`/chats/${chatId}/teach/action`, { kind }, onEvent, signal),
  teachAsk: (chatId: string, text: string, onEvent: (e: TeachEvent) => void, signal: AbortSignal) => events(`/chats/${chatId}/teach/ask`, { text }, onEvent, signal),
};

// Posts and calls onEvent for each server-sent event until the stream ends or is aborted.
async function events<E>(path: string, body: unknown, onEvent: (e: E) => void, signal: AbortSignal) {
  const res = await call("POST", path, body, signal);
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
}
