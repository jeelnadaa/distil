// App-wide state: route, library tree, providers and models, settings and toasts.
import { api, ApiError, type Chat, type Folder, type ModelInfo, type ModelRef, type NewPaper, type Provider, type SettingsView } from "./api.ts";

export type FolderTab = "materials" | "ledger" | "plan" | "practice" | "cards" | "progress";
const TABS: FolderTab[] = ["materials", "ledger", "plan", "practice", "cards", "progress"];
// home: the one place a chat starts (logo and New chat); folderId when it was started from a folder.
export type Route = { name: "home"; folderId?: string } | { name: "chat"; id: string } | { name: "today" } | { name: "usage" } | { name: "review"; folderId?: string } | { name: "folder"; id: string; tab: FolderTab }
  | { name: "material"; id: string; loc: number | null; item: string | null } | { name: "settings"; section?: string };

const parseHash = (): Route => {
  const [, name, id, sub, extra] = location.hash.split("/");
  if (name === "chat" && id) return { name: "chat", id };
  if (name === "material" && id) return { name: "material", id, loc: Number(sub) || null, item: extra || null };
  if (name === "folder" && id) return { name: "folder", id, tab: TABS.find((t) => t === sub) ?? "materials" };
  if (name === "today") return { name: "today" };
  if (name === "usage") return { name: "usage" };
  if (name === "review") return { name: "review", folderId: id || undefined };
  if (name === "settings") return { name: "settings", section: id };
  if (name === "new") return { name: "home", folderId: id || undefined };
  return { name: "home" };
};

export const nav = $state({ route: parseHash() as Route, sidebarOpen: false });
addEventListener("hashchange", () => {
  nav.route = parseHash();
  nav.sidebarOpen = false;
});
export const go = (hash: string) => { location.hash = hash; };

export const library = $state({ folders: [] as Folder[], chats: [] as Chat[], loaded: false });
export async function refreshLibrary() {
  const data = await api.library();
  library.folders = data.folders;
  library.chats = data.chats;
  library.loaded = true;
}

export const app = $state({
  settings: null as SettingsView | null,
  providers: [] as Provider[],
  models: {} as Record<string, ModelInfo[] | "loading" | { error: string }>,
});

export async function refreshProviders() {
  app.providers = await api.providers();
}
export async function refreshSettings() {
  app.settings = await api.settings();
}

// Loads (or reloads) the model list for every configured provider.
export async function loadModels(refresh = false) {
  await Promise.all(app.providers.filter((p) => p.configured).map(async (p) => {
    if (!refresh && Array.isArray(app.models[p.id])) return;
    app.models[p.id] = "loading";
    try {
      app.models[p.id] = await api.models(p.id, refresh);
    } catch (err) {
      app.models[p.id] = { error: err instanceof Error ? err.message : String(err) };
    }
  }));
}

// A message typed on the home screen, sent once its new chat opens.
// Where a top-bar popover opens: under its button, right-aligned, kept inside the window.
// Fixed positioning, so a narrow column can't clip it.
export function popoverAt(button: HTMLElement, width: number) {
  const r = button.getBoundingClientRect();
  const w = Math.min(width, innerWidth - 32);
  return { top: r.bottom + 6, left: Math.max(16, Math.min(r.right - w, innerWidth - w - 16)), width: w };
}

// The first message typed on the start screen, and the model picked there, handed to the new chat.
export const pending = $state({ chatId: null as string | null, text: "", model: null as ModelRef | null });

type Toast = { id: number; text: string; tone: "info" | "error" };
export const toasts = $state([] as Toast[]);
let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++toastId;
  toasts.push({ id, text, tone });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  }, tone === "error" ? 6000 : 3500);
}

// Runs an action and turns any failure into an error toast. Returns undefined on failure.
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    toast(err instanceof ApiError || err instanceof Error ? err.message : String(err), "error");
    return undefined;
  }
}

export const folderPath = (folderId: string | null): Folder[] => {
  const path: Folder[] = [];
  let current = library.folders.find((f) => f.id === folderId);
  while (current) {
    path.unshift(current);
    current = library.folders.find((f) => f.id === current!.parentId);
  }
  return path;
};

// Opens a lesson's chat (F-504). A new one starts with an opening message, since empty chats are tidied away.
export async function startLesson(id: string) {
  const chat = await attempt(() => api.startLesson(id));
  if (!chat) return;
  if (chat.createdAt === chat.updatedAt) Object.assign(pending, { chatId: chat.id, text: "Let's start the lesson.", model: null });
  await attempt(refreshLibrary);
  go(`#/chat/${chat.id}`);
}

// Starts writing a practice set or mock exam (F-801, F-803) and opens its chat, which shows the progress.
export async function newPaper(folderId: string, body: NewPaper) {
  const made = await attempt(() => api.createPaper(folderId, body));
  if (!made) return;
  await attempt(refreshLibrary);
  go(`#/chat/${made.chat.id}`);
}
