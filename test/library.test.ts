import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createLibrary, MAX_FOLDER_DEPTH, type Library } from "../server/library.ts";
import { createMessages } from "../server/messages.ts";

let lib: Library;
beforeEach(() => { lib = createLibrary(openDb(":memory:")); });

const chain = (depth: number) => {
  let parent: string | null = null;
  const ids: string[] = [];
  for (let i = 0; i < depth; i++) ids.push((parent = lib.createFolder(`L${i + 1}`, parent).id));
  return ids;
};

describe("folders", () => {
  it(`nest up to ${MAX_FOLDER_DEPTH} levels and no deeper`, () => {
    const ids = chain(MAX_FOLDER_DEPTH);
    expect(() => lib.createFolder("too deep", ids.at(-1)!)).toThrow(/5 levels/);
  });

  it("refuse a move that would exceed the depth limit", () => {
    const deep = chain(4);
    const [top] = chain(2);
    expect(() => lib.updateFolder(top!, { parentId: deep.at(-1)! })).toThrow(/deeper than 5/);
    expect(() => lib.updateFolder(top!, { parentId: deep[2]! })).not.toThrow();
  });

  it("refuse moving a folder into itself or its own subtree", () => {
    const [a, b] = chain(3);
    expect(() => lib.updateFolder(a!, { parentId: a! })).toThrow(/inside itself/);
    expect(() => lib.updateFolder(a!, { parentId: b! })).toThrow(/inside itself/);
  });

  it("delete their whole subtree, chats included, and report it first", () => {
    const [a, b] = chain(2);
    lib.createChat(a!);
    lib.createChat(b!);
    const kept = lib.createChat(null);
    expect(lib.folderContents(a!)).toEqual({ folders: 1, chats: 2 });
    lib.deleteFolder(a!);
    expect(lib.list()).toEqual({ folders: [], chats: [lib.getChat(kept.id)] });
  });

  it("reject blank names and normalise whitespace", () => {
    expect(() => lib.createFolder("   ", null)).toThrow(/empty/);
    expect(lib.createFolder("  Unit   2 ", null).name).toBe("Unit 2");
  });
});

describe("chat titles", () => {
  it("take an auto title only while still default; a manual rename always wins", () => {
    const chat = lib.createChat(null);
    expect(lib.setAutoTitle(chat.id, "Bayes' Theorem")).toBe(true);
    expect(lib.getChat(chat.id)).toMatchObject({ title: "Bayes' Theorem", titleSource: "auto" });
    expect(lib.setAutoTitle(chat.id, "Something Else")).toBe(false);

    const other = lib.createChat(null);
    lib.updateChat(other.id, { title: "My name" });
    expect(lib.setAutoTitle(other.id, "Auto")).toBe(false);
    expect(lib.getChat(other.id)).toMatchObject({ title: "My name", titleSource: "manual" });
  });
});

describe("messages", () => {
  it("mark replies left streaming by a crash as interrupted", () => {
    const db = openDb(":memory:");
    const chat = createLibrary(db).createChat(null);
    const messages = createMessages(db);
    messages.add({ chatId: chat.id, role: "assistant", content: "half", status: "streaming" });
    messages.recoverInterrupted();
    expect(messages.list(chat.id)[0]).toMatchObject({ status: "aborted", content: "half" });
  });
});
