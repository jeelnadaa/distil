import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// API keys live in their own file in the data folder, readable only by the current user where the OS
// supports it. They never reach the browser in full, never appear in logs and are only sent to the
// provider they belong to. The desktop build will move them into the OS credential store (F-1206).
// A provider can hold several labelled keys (a personal and a work account, say); the first is its default.
export type StoredKey = { id: string; label: string; key: string };

export function createSecrets(file: string) {
  const raw: Record<string, string | StoredKey[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  // Before several keys there was one string per provider.
  let keys: Record<string, StoredKey[]> = Object.fromEntries(Object.entries(raw).map(([provider, value]) =>
    [provider, typeof value === "string" ? [{ id: newId(), label: "Key 1", key: value }] : value]));

  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(keys, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* not supported on this filesystem */ }
  };
  const list = (providerId: string) => keys[providerId] ?? [];
  if (Object.values(raw).some((v) => typeof v === "string")) save();

  return {
    list,
    // The named key, or the provider's default when none is named or the named one is gone.
    get: (providerId: string, keyId?: string): StoredKey | null =>
      list(providerId).find((k) => k.id === keyId) ?? list(providerId)[0] ?? null,
    has: (providerId: string) => list(providerId).length > 0,
    add(providerId: string, key: string, label?: string): StoredKey {
      const taken = new Set(list(providerId).map((k) => k.label));
      let fallback = `Key ${list(providerId).length + 1}`;
      for (let n = list(providerId).length + 2; taken.has(fallback); n++) fallback = `Key ${n}`;
      const entry = { id: newId(), label: label?.trim().slice(0, 40) || fallback, key };
      keys = { ...keys, [providerId]: [...list(providerId), entry] };
      save();
      return entry;
    },
    remove(providerId: string, keyId?: string) {
      const rest = keyId ? list(providerId).filter((k) => k.id !== keyId) : [];
      const { [providerId]: _, ...others } = keys;
      keys = rest.length ? { ...others, [providerId]: rest } : others;
      save();
    },
  };
}

const newId = () => randomBytes(4).toString("hex");

export type Secrets = ReturnType<typeof createSecrets>;

// "sk-ant-api03-abcd…wxyz" → "sk-ant••••••wxyz": enough to recognise, useless to steal.
export const maskKey = (key: string) => (key.length <= 10 ? "••••••" : `${key.slice(0, 6)}••••••${key.slice(-4)}`);
