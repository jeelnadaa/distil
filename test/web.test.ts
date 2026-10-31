import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../server/main.ts";
import { articleMarkdown, parseUrl } from "../server/materials/web.ts";
import { makePdf } from "./fixtures.ts";

const filler = "Variance measures how far a set of numbers is spread out from their average value. ".repeat(4);
const PAGE = String.raw`<!doctype html><html><head><title>Variance - Stats Wiki</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article>
  <h1>Variance</h1>
  <p>${filler}</p>
  <h2>Definition</h2>
  <p>The variance of a sample is
    <span class="mwe-math-element"><math alttext="{\displaystyle s^{2}}"><semantics><mi>s</mi><annotation encoding="application/x-tex">{\displaystyle s^{2}}</annotation></semantics></math></span>,
    computed as:</p>
  <p><span class="katex-display"><span class="katex"><math display="block"><semantics><mrow></mrow><annotation encoding="application/x-tex">s^2 = \frac{\sum (x - \bar{x})^2}{n - 1}</annotation></semantics></math></span></span></p>
  <ul><li>Always <strong>non-negative</strong></li><li>Zero only when all values are equal</li></ul>
  <table><tr><th>x</th><th>x²</th></tr><tr><td>1</td><td>1</td></tr></table>
  <p>${filler}</p>
</article>
<footer>Copyright footer text</footer>
</body></html>`;

describe("web articles", () => {
  it("keeps the article as Markdown with its maths as LaTeX", () => {
    const { title, markdown } = articleMarkdown(PAGE, "https://stats.example/variance");
    expect(title).toMatch(/Variance/);
    expect(markdown).toContain("Source: <https://stats.example/variance>");
    expect(markdown).toContain("## Definition");
    expect(markdown).toContain("$s^{2}$");
    expect(markdown).toContain(String.raw`$$s^2 = \frac{\sum (x - \bar{x})^2}{n - 1}$$`);
    expect(markdown).toContain("- Always **non-negative**");
    expect(markdown).toContain("| x | x² |");
    expect(markdown).not.toContain("About");
    expect(markdown).not.toContain("Copyright footer");
  });

  it("only takes http and https links", () => {
    expect(() => parseUrl("file:///etc/passwd")).toThrow(/http and https/);
    expect(() => parseUrl("not a link")).toThrow(/web address/);
  });

  it("adds a page or a linked PDF as a material that remembers its source", async () => {
    const pdf = makePdf([["Sampling theorem", "Sample at twice the highest frequency."]]);
    const fetch = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith(".pdf")) return new Response(new Blob([pdf as Uint8Array<ArrayBuffer>]), { headers: { "content-type": "application/pdf" } });
      if (url.includes("missing")) return new Response("nope", { status: 404 });
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as typeof globalThis.fetch;
    const server = createServer({ port: 5173, dataDir: mkdtempSync(join(tmpdir(), "distil-web-")), fetch });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await server.app.fetch(new Request(`http://localhost:5173/api${path}`, {
        method, headers: { host: "localhost:5173", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      }));
      return { status: res.status, json: await res.json() };
    };
    const folder = (await call("POST", "/folders", { name: "Stats", parentId: null })).json;

    const page = await call("POST", `/folders/${folder.id}/materials/url`, { url: "https://stats.example/variance" });
    expect(page.status).toBe(201);
    expect(page.json).toMatchObject({ kind: "markdown", source: "https://stats.example/variance", name: expect.stringMatching(/Variance.*\.md$/) });
    const doc = await call("POST", `/folders/${folder.id}/materials/url`, { url: "https://dsp.example/notes/sampling.pdf" });
    expect(doc.json).toMatchObject({ kind: "pdf", name: "sampling.pdf" });
    await server.jobs.idle();
    const detail = (await call("GET", `/materials/${page.json.id}`)).json;
    expect(detail.material.status).toBe("ready");
    expect(detail.chunks.map((c: { text: string }) => c.text).join("\n")).toContain(String.raw`\frac`);

    expect((await call("POST", `/folders/${folder.id}/materials/url`, { url: "https://stats.example/variance" })).status).toBe(409);
    expect((await call("POST", `/folders/${folder.id}/materials/url`, { url: "https://stats.example/missing" })).json).toMatchObject({ code: "fetch_failed" });
  });
});
