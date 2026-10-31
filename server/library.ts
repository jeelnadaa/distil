import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { DEFAULT_CHAT_TITLE, MAX_FOLDER_DEPTH } from "./constants.ts";
import { AppError, notFound } from "./errors.ts";

export { MAX_FOLDER_DEPTH };

export type Folder = { id: string; parentId: string | null; name: string; createdAt: number };
export type Chat = {
  id: string;
  folderId: string | null;
  title: string;
  titleSource: "default" | "auto" | "manual";
  mode: string;
  model: { provider: string; id: string } | null;
  createdAt: number;
  updatedAt: number;
};

type FolderRow = { id: string; parent_id: string | null; name: string; created_at: number };
type ChatRow = {
  id: string; folder_id: string | null; title: string; title_source: Chat["titleSource"]; mode: string;
  model_provider: string | null; model_id: string | null; created_at: number; updated_at: number;
};

const toFolder = (r: FolderRow): Folder => ({ id: r.id, parentId: r.parent_id, name: r.name, createdAt: r.created_at });
const toChat = (r: ChatRow): Chat => ({
  id: r.id, folderId: r.folder_id, title: r.title, titleSource: r.title_source, mode: r.mode,
  model: r.model_provider && r.model_id ? { provider: r.model_provider, id: r.model_id } : null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const cleanName = (name: string, what: string) => {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new AppError(400, "invalid_name", `${what} name can't be empty.`);
  if (trimmed.length > 120) throw new AppError(400, "invalid_name", `${what} name is too long (120 characters max).`);
  return trimmed;
};

export function createLibrary(db: Db, now = () => Date.now()) {
  const folderRow = (id: string) => db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as FolderRow | undefined;
  const chatRow = (id: string) => db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined;

  // Depth of a folder counting itself: a root-level folder is depth 1.
  const depthOf = (id: string): number => {
    const row = db.prepare(`
      WITH RECURSIVE up(id, parent_id, depth) AS (
        SELECT id, parent_id, 1 FROM folders WHERE id = ?
        UNION ALL SELECT f.id, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
      ) SELECT MAX(depth) AS depth FROM up`).get(id) as { depth: number | null };
    return row.depth ?? 0;
  };

  // Levels in the subtree rooted at a folder, counting itself: a leaf folder has height 1.
  const heightOf = (id: string): number => {
    const row = db.prepare(`
      WITH RECURSIVE down(id, depth) AS (
        SELECT id, 1 FROM folders WHERE id = ?
        UNION ALL SELECT f.id, down.depth + 1 FROM folders f JOIN down ON f.parent_id = down.id
      ) SELECT MAX(depth) AS depth FROM down`).get(id) as { depth: number };
    return row.depth;
  };

  const isDescendant = (id: string, ancestorId: string): boolean => {
    const row = db.prepare(`
      WITH RECURSIVE up(id, parent_id) AS (
        SELECT id, parent_id FROM folders WHERE id = ?
        UNION ALL SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
      ) SELECT 1 AS hit FROM up WHERE id = ?`).get(id, ancestorId);
    return row !== undefined;
  };

  const requireFolder = (id: string) => {
    const row = folderRow(id);
    if (!row) throw notFound("Folder");
    return row;
  };

  const getChat = (id: string): Chat => {
    const row = chatRow(id);
    if (!row) throw notFound("Chat");
    return toChat(row);
  };

  return {
    list() {
      const folders = (db.prepare("SELECT * FROM folders ORDER BY name COLLATE NOCASE").all() as FolderRow[]).map(toFolder);
      const chats = (db.prepare("SELECT * FROM chats ORDER BY updated_at DESC").all() as ChatRow[]).map(toChat);
      return { folders, chats };
    },

    createFolder(name: string, parentId: string | null): Folder {
      if (parentId) {
        requireFolder(parentId);
        if (depthOf(parentId) >= MAX_FOLDER_DEPTH) {
          throw new AppError(400, "too_deep", `Folders can nest ${MAX_FOLDER_DEPTH} levels deep at most.`);
        }
      }
      const folder = { id: randomUUID(), parentId, name: cleanName(name, "Folder"), createdAt: now() };
      db.prepare("INSERT INTO folders (id, parent_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(folder.id, folder.parentId, folder.name, folder.createdAt);
      return folder;
    },

    updateFolder(id: string, patch: { name?: string; parentId?: string | null }): Folder {
      const row = requireFolder(id);
      const name = patch.name === undefined ? row.name : cleanName(patch.name, "Folder");
      let parentId = row.parent_id;
      if (patch.parentId !== undefined && patch.parentId !== row.parent_id) {
        parentId = patch.parentId;
        if (parentId) {
          requireFolder(parentId);
          if (parentId === id || isDescendant(parentId, id)) {
            throw new AppError(400, "invalid_move", "A folder can't move inside itself.");
          }
          if (depthOf(parentId) + heightOf(id) > MAX_FOLDER_DEPTH) {
            throw new AppError(400, "too_deep", `That move would nest folders deeper than ${MAX_FOLDER_DEPTH} levels.`);
          }
        }
      }
      db.prepare("UPDATE folders SET name = ?, parent_id = ? WHERE id = ?").run(name, parentId, id);
      return toFolder({ ...row, name, parent_id: parentId });
    },

    // Deletes the folder, its subfolders and every chat inside them (foreign keys cascade).
    deleteFolder(id: string) {
      requireFolder(id);
      db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    },

    // Counts what a folder delete would remove, for the confirmation dialog.
    folderContents(id: string) {
      requireFolder(id);
      return db.prepare(`
        WITH RECURSIVE down(id) AS (
          SELECT id FROM folders WHERE id = ?
          UNION ALL SELECT f.id FROM folders f JOIN down ON f.parent_id = down.id
        ) SELECT (SELECT COUNT(*) - 1 FROM down) AS folders,
                 (SELECT COUNT(*) FROM chats WHERE folder_id IN (SELECT id FROM down)) AS chats`)
        .get(id) as { folders: number; chats: number };
    },

    getChat,

    createChat(folderId: string | null): Chat {
      if (folderId) requireFolder(folderId);
      const at = now();
      const chat: Chat = {
        id: randomUUID(), folderId, title: DEFAULT_CHAT_TITLE, titleSource: "default", mode: "ask",
        model: null, createdAt: at, updatedAt: at,
      };
      db.prepare(`INSERT INTO chats (id, folder_id, title, title_source, mode, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(chat.id, chat.folderId, chat.title, chat.titleSource, chat.mode, at, at);
      return chat;
    },

    updateChat(id: string, patch: { title?: string; folderId?: string | null; model?: Chat["model"] }): Chat {
      const chat = getChat(id);
      if (patch.folderId) requireFolder(patch.folderId);
      const next: Chat = {
        ...chat,
        ...(patch.title !== undefined && { title: cleanName(patch.title, "Chat"), titleSource: "manual" as const }),
        ...(patch.folderId !== undefined && { folderId: patch.folderId }),
        ...(patch.model !== undefined && { model: patch.model }),
      };
      db.prepare("UPDATE chats SET title = ?, title_source = ?, folder_id = ?, model_provider = ?, model_id = ? WHERE id = ?")
        .run(next.title, next.titleSource, next.folderId, next.model?.provider ?? null, next.model?.id ?? null, id);
      return next;
    },

    // Applies an automatic title only while the chat still has its default one, so a manual rename always wins.
    setAutoTitle(id: string, title: string): boolean {
      const result = db.prepare("UPDATE chats SET title = ?, title_source = 'auto' WHERE id = ? AND title_source = 'default'")
        .run(title, id);
      return result.changes > 0;
    },

    touchChat(id: string) {
      db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), id);
    },

    deleteChat(id: string) {
      getChat(id);
      db.prepare("DELETE FROM chats WHERE id = ?").run(id);
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
