// Product limits shared by the server and the UI. No Node imports here: the browser bundles this file.
export const MAX_FOLDER_DEPTH = 5;
export const DEFAULT_CHAT_TITLE = "New chat";
// Kinds of learning item in the Coverage Ledger (F-301).
export const ITEM_TYPES = ["concept", "definition", "formula", "theorem", "derivation", "procedure", "fact", "example", "diagram", "code"] as const;
// Plans a folder keeps: the active one and earlier ones to switch back to (owner, 2026-11-01).
export const MAX_PLANS = 3;
