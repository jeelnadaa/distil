// App-wide state: route, library tree, providers and models, settings and toasts.
import { api, ApiError, type Chat, type Folder, type ModelInfo, type Provider, type SettingsView } from "./api.ts";

export type FolderTab = "materials" | "ledger";
// home: the one place a chat starts (logo and New chat); folderId when it was started from a folder.
export type Route = { name: "home"; folderId?: string } | { name: "chat"; id: string } | { name: "folder"; id: string; tab: FolderTab }
  | { name: "material"; id: string; loc: number | null; item: string | null } | { name: "settings"; section?: string };

const parseHash = (): Route => {
  const [, name, id, sub, extra] = location.hash.split("/");
  if (name === "chat" && id) return { name: "chat", id };
  if (name === "material" && id) return { name: "material", id, loc: Number(sub) || null, item: extra || null };
  if (name === "folder" && id) return { name: "folder", id, tab: sub === "ledger" ? "ledger" : "materials" };
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
export const pending = $state({ chatId: null as string | null, text: "" });

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
