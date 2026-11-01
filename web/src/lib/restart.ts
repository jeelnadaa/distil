import { api } from "./api.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Asks the desktop launcher to restart the server, then reloads the page once it answers again.
export async function restartApp() {
  await api.restart();
  await wait(1000);
  for (let i = 0; i < 60; i++) {
    const up = await fetch("/api/app").then((r) => r.ok, () => false);
    if (up) return location.reload();
    await wait(1000);
  }
  throw new Error("Distil didn't come back after restarting. Open it again from the Start menu.");
}
