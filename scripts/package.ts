// Builds the Windows release (F-1305): `npm run package [-- --feed <update feed URL>]`.
//
// release/Distil-<v>-win-x64/       the install folder: Install Distil.cmd, Install.ps1, the Node runtime, launcher, app-<v>/
// release/Distil-<v>-win-x64.zip    that folder zipped, to hand out
// release/app-<v>.zip               the app folder alone: the payload an update downloads
// release/feed.json                 the update feed entry for this version (url, sha256)
//
// The runtime is the Node that runs this script (Node 24 runs Distil's TypeScript as is), and the app's
// production dependencies come from node_modules, so building needs nothing downloaded.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { Zip } from "fflate";
import sharp from "sharp";
import { ZipEntry } from "../server/zip.ts";

const repo = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
const feedArg = process.argv.indexOf("--feed");
const feed = feedArg > 0 ? process.argv[feedArg + 1] : null;
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build the Windows release on Windows x64: it ships this machine's Node runtime.");
if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Build with Node 24 or later.");

const release = join(repo, "release");
const name = `Distil-${pkg.version}-win-x64`;
const out = join(release, name);
const appName = `app-${pkg.version}`;
const app = join(out, appName);
const step = (msg: string) => console.log(`· ${msg}`);

step("building the UI");
execSync("npx vite build", { cwd: repo, stdio: "inherit" });
rmSync(release, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

step("copying the app");
cpSync(join(repo, "server"), join(app, "server"), { recursive: true });
cpSync(join(repo, "dist"), join(app, "dist"), { recursive: true });
for (const f of ["package.json", "LICENSE"]) cpSync(join(repo, f), join(app, f));

// Production dependencies and everything they need, each package folder copied whole.
step("copying production dependencies");
const modules = join(repo, "node_modules");
const seen = new Set<string>();
const visit = (dep: string) => {
  if (seen.has(dep) || !existsSync(join(modules, dep, "package.json"))) return;
  seen.add(dep);
  const meta = JSON.parse(readFileSync(join(modules, dep, "package.json"), "utf8")) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  for (const d of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) visit(d);
};
Object.keys(pkg.dependencies).forEach(visit);
for (const dep of seen) {
  cpSync(join(modules, dep), join(app, "node_modules", dep), {
    recursive: true,
    // Native binaries for other systems are dead weight in a Windows x64 build, and so are the
    // transformers sources and type files (Node loads its dist build), which also hold its longest paths.
    filter: (src) => !/[\\/]bin[\\/]napi-v\d+[\\/](darwin|linux|win32[\\/]arm64)/.test(src) && !/[\\/]@img[\\/]sharp-(?!win32-x64)/.test(src)
      && !/[\\/]@huggingface[\\/]transformers[\\/](src|types)([\\/]|$)/.test(src),
  });
}

step("writing credits");
const credits = [...seen].sort().map((dep) => {
  const meta = JSON.parse(readFileSync(join(modules, dep, "package.json"), "utf8")) as { version: string; license?: string | { type: string }; homepage?: string };
  const license = typeof meta.license === "object" ? meta.license.type : meta.license ?? "see the package";
  return `| ${dep} | ${meta.version} | ${license} |`;
});
const header = readFileSync(join(repo, "CREDITS.md"), "utf8");
writeFileSync(join(app, "CREDITS.md"), `${header}\n## Bundled packages\n\n| Package | Version | License |\n|---|---|---|\n${credits.join("\n")}\n\nThe runtime is Node.js ${process.versions.node} (MIT; https://github.com/nodejs/node/blob/main/LICENSE).\n`);

step("adding the runtime, launcher and installer");
mkdirSync(join(out, "runtime"));
cpSync(process.execPath, join(out, "runtime", "node.exe"));
for (const f of ["launcher.mjs", "Install Distil.cmd", "Install.ps1", "Uninstall.ps1"]) cpSync(join(repo, "desktop", f), join(out, f));
cpSync(join(app, "CREDITS.md"), join(out, "CREDITS.md"));
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));
writeFileSync(join(out, "current.txt"), appName);
if (feed) writeFileSync(join(out, "update-feed.txt"), feed);

// A Windows icon holding PNG images, drawn from the app icon.
const svg = join(repo, "design", "assets", "logo", "distil-icon.svg");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: 600 }).resize(s, s).png().toBuffer()));
const ico = Buffer.alloc(6 + 16 * sizes.length);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(sizes.length, 4);
let offset = ico.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  ico.writeUInt8(s === 256 ? 0 : s, at);
  ico.writeUInt8(s === 256 ? 0 : s, at + 1);
  ico.writeUInt16LE(1, at + 4);
  ico.writeUInt16LE(32, at + 6);
  ico.writeUInt32LE(pngs[i]!.length, at + 8);
  ico.writeUInt32LE(offset, at + 12);
  offset += pngs[i]!.length;
});
writeFileSync(join(out, "distil.ico"), Buffer.concat([ico, ...pngs]));

const filesIn = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? filesIn(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []);

// Streams a folder into a zip. Entries are deflated (level 0 for files that are compressed already),
// so the app's own streaming unzip can read an update.
async function zipFolder(dir: string, file: string, prefix = "") {
  const sink = createWriteStream(file);
  const hash = createHash("sha256");
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    hash.update(chunk);
    sink.write(chunk);
  });
  for (const path of filesIn(dir)) {
    const level = /\.(png|jpe?g|webp|woff2?|gz|zip|onnx|node|dll|exe)$/i.test(path) ? 0 : 6;
    const entry = new ZipEntry(prefix + relative(dir, path).split("\\").join("/"), level);
    zip.add(entry);
    for await (const chunk of createReadStream(path)) entry.push(chunk as Uint8Array);
    entry.push(new Uint8Array(0), true);
    if (sink.writableNeedDrain) await new Promise((r) => sink.once("drain", r));
  }
  zip.end();
  await new Promise<void>((resolve, reject) => sink.end((err?: Error | null) => (err ? reject(err) : resolve())));
  return { sha256: hash.digest("hex"), size: statSync(file).size };
}

// Reads every entry back and checks its CRC, so a damaged zip stops the build instead of reaching anyone.
function verifyZip(file: string) {
  const zip = readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`${file} has no end record.`);
  let at = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(at + 20)));
    if (data.length !== zip.readUInt32LE(at + 24) || crc32(data) !== zip.readUInt32LE(at + 16)) throw new Error(`${file} is damaged at ${name}.`);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return count;
}

// The installer compares this with what it finds, to catch a zip that didn't fully extract.
writeFileSync(join(out, "app-files.txt"), String(filesIn(app).length));

step("zipping the update payload");
const update = await zipFolder(app, join(release, `${appName}.zip`));
writeFileSync(join(release, "feed.json"), `${JSON.stringify({ version: pkg.version, url: `${appName}.zip`, sha256: update.sha256, notes: "", minRuntime: `${process.versions.node.split(".")[0]}.0.0` }, null, 2)}\n`);
step("zipping the install folder");
const bundle = await zipFolder(out, join(release, `${name}.zip`), `${name}/`);
step(`checked ${verifyZip(join(release, `${appName}.zip`)) + verifyZip(join(release, `${name}.zip`))} zip entries`);

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;
console.log(`\nRelease ${pkg.version} in ${relative(repo, release)}:`);
console.log(`  ${name}.zip   ${mb(bundle.size)}  (unzip, then double-click Install Distil.cmd)`);
console.log(`  ${appName}.zip   ${mb(update.size)}  (update payload; sha256 in feed.json)`);
if (!feed) console.log("  No --feed given: this build won't check for updates.");
