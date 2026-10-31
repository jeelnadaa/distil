import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../web/src/lib/markdown.ts";

describe("renderMarkdown", () => {
  it("renders inline and display maths", () => {
    expect(renderMarkdown("Area is $\\pi r^2$.")).toContain("katex");
    expect(renderMarkdown("$$\n\\int_0^1 x\\,dx\n$$")).toContain('class="math-block"');
    expect(renderMarkdown("So \\(a+b\\) holds.")).toContain("katex");
    expect(renderMarkdown("\\[\nE = mc^2\n\\]")).toContain('class="math-block"');
  });

  it("renders a bare # in maths instead of a KaTeX error", () => {
    const html = renderMarkdown("$\\text{mean} + (\\text{#ofSTDEV})$");
    expect(html).not.toContain("katex-error");
    expect(renderMarkdown("$\\#x$")).not.toContain("katex-error");
  });

  it("leaves prices and escaped dollars alone", () => {
    const html = renderMarkdown("It costs $5 and $6 today, or \\$7.");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5 and $6");
  });

  it("escapes raw HTML", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> <script>bad()</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("highlights code and opens links outside the app", () => {
    expect(renderMarkdown("```js\nconst a = 1;\n```")).toContain('class="hljs"');
    expect(renderMarkdown("[x](https://example.com)")).toContain('rel="noopener noreferrer"');
  });
});
