import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// API keys live in their own file in the data folder, readable only by the current user where the OS
// supports it. They never reach the browser in full, never appear in logs and are only sent to the
// provider they belong to. The desktop build will move them into the OS credential store (F-1206).
export function createSecrets(file: string) {
  let keys: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(keys, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* not supported on this filesystem */ }
  };

  return {
    get: (providerId: string): string | null => keys[providerId] ?? null,
    has: (providerId: string) => providerId in keys,
    set(providerId: string, key: string) {
      keys = { ...keys, [providerId]: key };
      save();
    },
    remove(providerId: string) {
      const { [providerId]: _, ...rest } = keys;
      keys = rest;
      save();
    },
  };
}

export type Secrets = ReturnType<typeof createSecrets>;

// "sk-ant-api03-abcd…wxyz" → "sk-ant••••••wxyz": enough to recognise, useless to steal.
export const maskKey = (key: string) => (key.length <= 10 ? "••••••" : `${key.slice(0, 6)}••••••${key.slice(-4)}`);
