import { describe, expect, it } from "vitest";
import { lintMiniApp } from "../server/visuals/lint.ts";
import { nearestToken, sanitizeSvg } from "../server/visuals/sanitize.ts";

describe("SVG sanitiser (F-753)", () => {
  it("keeps the restricted profile", () => {
    const { svg, removed } = sanitizeSvg('<svg viewBox="0 0 100 50"><g transform="translate(10,5)"><rect x="0" y="0" width="40" height="20" rx="6" class="fill-3"/>'
      + '<text x="20" y="12" text-anchor="middle" class="label">a &lt; b</text><path d="M0 0L10 10" class="accent"/></g></svg>');
    expect(removed).toEqual([]);
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><g transform="translate(10,5)"><rect x="0" y="0" width="40" height="20" rx="6" class="fill-3"/>'
      + '<text x="20" y="12" text-anchor="middle" class="label">a &lt; b</text><path d="M0 0L10 10" class="accent"/></g></svg>');
  });

  const hostile = [
    '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle r="2"/></svg>',
    '<svg viewBox="0 0 10 10" onload="alert(1)"><circle r="2" onclick="steal()"/></svg>',
    '<svg viewBox="0 0 10 10"><style>circle{fill:red}</style><circle r="2" style="fill:red"/></svg>',
    '<svg viewBox="0 0 10 10"><a href="javascript:alert(1)"><circle r="2"/></a></svg>',
    '<svg viewBox="0 0 10 10"><foreignObject><iframe src="https://evil"></iframe></foreignObject></svg>',
    '<svg viewBox="0 0 10 10"><image href="https://evil/x.png"/><use href="#x"/></svg>',
    '<svg viewBox="0 0 10 10"><circle r="2" fill="url(https://evil)" class="fill-2 evil"/></svg>',
    '<svg viewBox="0 0 10 10"><script>if (a<b) { x() }</script><circle r="2"/></svg>',
    '<svg viewBox="0 0 10 10"><text font-family="Comic Sans" font-size="40">hi</text></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg viewBox="0 0 10 10"><text>&x;</text></svg>',
    '<svg viewBox="0 0 10 10"><path d="M0 0 javascript:alert(1)"/><rect width="calc(100%)"/></svg>',
  ];
  it.each(hostile)("strips %s", (input) => {
    const { svg, removed } = sanitizeSvg(input);
    expect(removed.length).toBeGreaterThan(0);
    expect(svg).not.toMatch(/script|onload|onclick|style|href|foreignObject|iframe|image|evil|font-|ENTITY|calc|javascript|<use/i);
  });

  it("maps stray colours to the nearest token class", () => {
    const { svg } = sanitizeSvg('<svg width="20" height="10"><rect fill="#e33" stroke="black"/><circle fill="#4f6e4b"/><text fill="#777">x</text><rect fill="white"/><line stroke="none"/></svg>');
    expect(svg).toContain('viewBox="0 0 20 10"');
    expect(svg).toContain('<rect class="accent ink"/>');
    expect(svg).toContain('<circle class="fill-3"/>');
    expect(svg).toContain('<text class="muted">x</text>');
    expect(svg).toContain("<rect/>");
    expect(svg).toContain('<line stroke="none"/>');
    expect(nearestToken("not a colour", false)).toBeNull();
  });

  it("closes what the model left open and refuses non-figures", () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><g><text>hi').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><text>hi</text></g></svg>');
    expect(() => sanitizeSvg("<div>hello</div>")).toThrow(/no <svg>/);
    expect(() => sanitizeSvg("<svg><circle/></svg>")).toThrow(/viewBox/);
    expect(() => sanitizeSvg(`<svg viewBox="0 0 1 1">${"<g/>".repeat(2001)}</svg>`)).toThrow(/too many/);
  });
});

describe("mini-app design lint (F-755)", () => {
  it("passes an app written with the kit", () => {
    const html = `<div class="stack"><label class="slider">Angle <input type="range" min="0" max="90"></label><output class="readout">0</output>
<canvas class="plot"></canvas></div>
<style>.stack { display: grid; gap: var(--s-3); } .plot { border-color: var(--border); }</style>
<script>
const ctx = document.querySelector("canvas").getContext("2d");
ctx.strokeStyle = distil.color("accent");
ctx.font = distil.font(12);
el.setAttribute("fill", "none");
</script>`;
    expect(lintMiniApp(html)).toEqual([]);
  });

  it.each([
    ['<p style="color: #ff0000">x</p>', /hard-codes a colour/],
    ["<style>body { background: white }</style>", /hard-codes a colour/],
    ["<style>h1 { font-family: Arial }</style>", /font-family/],
    ['<link rel="stylesheet" href="https://cdn/x.css">', /Remove <link>/],
    ['<script src="https://cdn/d3.js"></script>', /<script src>/],
    ['<script>ctx.fillStyle = "#333";</script>', /distil.color/],
    ['<script>ctx.font = "12px Arial";</script>', /distil.font/],
    ["<script>fetch('/api/settings')</script>", /network/],
    ["<script>localStorage.x = 1</script>", /storage/],
    ["<script>alert('hi')</script>", /alert/],
    ['<svg><circle fill="red"/></svg>', /hard-codes a colour/],
    ["<style>.a { color: var(--accent) !important }</style>", /!important/],
    ["<script>el.style.background = 'rgb(1,2,3)'</script>", /hard-codes a colour/],
  ])("flags %s", (html, message) => {
    const errors = lintMiniApp(html);
    expect(errors.join("\n")).toMatch(message);
    expect(errors[0]).toMatch(/^Line \d+: /);
  });
});
