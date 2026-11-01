// Distil's Windows launcher (F-1305). It lives at the root of the install folder and stays the same
// across updates. It runs the current app folder's server with the bundled Node runtime, opens Distil
// in its own Edge (or Chrome) app window, starts the server again when it asks to restart (after a
// restore or an update, switching to a staged update first), and stops it when the window closes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const root = dirname(self);
const port = Number(process.env.DISTIL_PORT ?? 4317);
const url = `http://localhost:${port}`;
const RESTART_CODE = 75;
const dataDir = process.env.DISTIL_DATA_DIR ?? join(homedir(), "Distil");
const local = join(process.env.LOCALAPPDATA ?? dataDir, "Distil");
const logFile = join(local, "distil.log");

// Started from a shortcut, Node has a console window: start again detached, without one, and leave.
if (!process.env.DISTIL_LAUNCHED) {
  spawn(process.execPath, [self, ...process.argv.slice(2)], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, DISTIL_LAUNCHED: "1" } }).unref();
  process.exit(0);
}

mkdirSync(local, { recursive: true });
if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) truncateSync(logFile, 0);
const log = (msg) => writeFileSync(logFile, `${new Date().toISOString()} [launcher] ${msg}\n`, { flag: "a" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const answering = async () => {
  try {
    const res = await fetch(`${url}/api/app`, { signal: AbortSignal.timeout(1500) });
    return res.ok && typeof (await res.json()).version === "string";
  } catch {
    return false;
  }
};

// A staged update (next.txt) becomes current; the version it replaces is kept for going back, older ones go.
function appDir() {
  const current = readFileSync(join(root, "current.txt"), "utf8").trim();
  const nextFile = join(root, "next.txt");
  if (!existsSync(nextFile)) return join(root, current);
  const next = readFileSync(nextFile, "utf8").trim();
  rmSync(nextFile);
  if (!/^app-[\w.-]+$/.test(next) || !existsSync(join(root, next, "package.json"))) {
    log(`ignored a staged update without its files: ${next}`);
    return join(root, current);
  }
  writeFileSync(join(root, "current.txt"), next);
  for (const old of readdirSync(root)) {
    if (/^app-/.test(old) && old !== next && old !== current) rmSync(join(root, old), { recursive: true, force: true });
  }
  log(`updated from ${current} to ${next}`);
  return join(root, next);
}

function startServer() {
  const dir = appDir();
  const out = openSync(logFile, "a");
  log(`starting ${dir}`);
  return spawn(process.execPath, [join(dir, "server", "index.ts")], {
    cwd: dir, stdio: ["ignore", out, out], windowsHide: true,
    env: { ...process.env, PORT: String(port), DISTIL_SUPERVISED: "1", DISTIL_INSTALL_DIR: root, DISTIL_DATA_DIR: dataDir, NODE_ENV: "production" },
  });
}

// Edge ships with Windows; Chrome is the fallback. Each gets its own profile, so the window is Distil's
// alone and closing it is the signal to stop.
function openWindow() {
  const dirs = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const browser = dirs.flatMap((d) => [join(d, "Microsoft", "Edge", "Application", "msedge.exe"), join(d, "Google", "Chrome", "Application", "chrome.exe")]).find(existsSync);
  if (!browser) {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return null;
  }
  return spawn(browser, [`--app=${url}`, `--user-data-dir=${join(local, "window")}`, "--no-first-run", "--no-default-browser-check", "--window-size=1320,880"], { stdio: "ignore" });
}

function alert(message) {
  const text = message.replace(/'/g, "''");
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text}', 'Distil') | Out-Null`], { stdio: "ignore", windowsHide: true });
}

async function main() {
  // Already running (opened twice): another window on the same server is enough.
  if (await answering()) {
    openWindow();
    return;
  }
  let server = startServer();
  let quitting = false;
  const supervise = () => server.on("exit", (code) => {
    if (quitting) return process.exit(0);
    if (code === RESTART_CODE) {
      log("restarting");
      server = startServer();
      supervise();
      return;
    }
    log(`the server stopped (exit ${code})`);
    alert(`Distil stopped unexpectedly. Details are in ${logFile}.`);
    process.exit(1);
  });
  supervise();

  for (let i = 0; i < 60 && !(await answering()); i++) await wait(500);
  if (!(await answering())) {
    quitting = true;
    server.kill();
    alert(`Distil couldn't start. Details are in ${logFile}.`);
    return;
  }
  if (process.env.DISTIL_NO_WINDOW) return; // for testing the install without opening a window
  const window = openWindow();
  window?.on("exit", () => {
    quitting = true;
    log("window closed");
    server.kill();
  });
}

main().catch((err) => {
  log(String(err?.stack ?? err));
  alert(`Distil couldn't start: ${err?.message ?? err}`);
  process.exit(1);
});
