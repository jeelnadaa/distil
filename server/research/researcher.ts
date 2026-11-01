import { z } from "zod";
import { AppError } from "../errors.ts";
import type { Jobs } from "../jobs.ts";
import { complete, completeJson, type LlmDeps } from "../llm.ts";
import { parseLabel } from "../materials/ingest.ts";
import type { Materials } from "../materials/store.ts";
import type { Secrets } from "../secrets.ts";
import { SEARCH_LABEL, searchSecret, type SearchResult, webSearch } from "./search.ts";

// Topic-only subjects (F-205): with no material, the researcher writes a reference syllabus for the topic
// and adds it to the folder as a Markdown material, so distilling, planning and teaching work as usual.
// With a web search key it searches each section and cites what it found; without one it writes from the
// model's own knowledge and the material says so in its name and its first lines.

export type ResearchDeps = LlmDeps & { jobs: Jobs; materials: Materials; secrets: Secrets; fetch?: typeof fetch };

const SECTIONS_MAX = 14;
const PER_SECTION = 4;

const Outline = z.object({
  title: z.string().min(1).max(160),
  sections: z.array(z.object({ title: z.string().min(1).max(160), covers: z.string().max(600).default(""), query: z.string().min(1).max(200) })).min(1).max(SECTIONS_MAX),
});
const OUTLINE = `You plan a reference syllabus: the material a learner will study from when they have none of their own.
Reply with JSON only: {"title": "…", "sections": [{"title": "…", "covers": "what this section must teach", "query": "a web search query for it"}]}
- 6 to ${SECTIONS_MAX} sections in teaching order, from foundations to the level the request asks for, nothing beyond it.
- Each section one coherent topic; together they cover everything the request needs.`;
const WRITE = `You write one section of a reference syllabus a learner will study from. Write it as a clear, complete textbook section in Markdown:
definitions, key facts, formulas in $…$, a worked example where it helps, and common mistakes. Start with "## " and the section title.
Be exact; never invent facts, figures or citations.`;
const CITE = `Use the numbered web sources given. After every claim taken from a source put its number in brackets, like [2]. Prefer what the sources say; add general knowledge only to connect it, uncited.`;
const OWN = `You have no sources: write from well-established knowledge only, and leave out anything you're unsure of.`;

export function createResearcher(deps: ResearchDeps) {
  const searchKey = () => {
    const provider = deps.settings.get().webSearch;
    const key = provider ? deps.secrets.get(searchSecret(provider))?.key : null;
    return provider && key ? { provider, key } : null;
  };

  function start(folderId: string, topic: string) {
    return deps.jobs.enqueue("research", `Researching ${topic.length > 60 ? `${topic.slice(0, 59)}…` : topic}`, { folderId, params: { topic } });
  }

  async function run(folderId: string, topic: string, signal: AbortSignal, progress: (done: number, total: number) => void) {
    const outline = await completeJson(deps, Outline, { slot: "strong", role: "researcher", folderId, system: OUTLINE, prompt: `What the learner wants to learn:\n${topic}`, maxTokens: 2000, signal });
    const search = searchKey();
    const sources: SearchResult[] = [];
    const parts: string[] = [];
    const total = outline.sections.length;
    for (const [i, section] of outline.sections.entries()) {
      progress(i, total);
      let found: { n: number; r: SearchResult }[] = [];
      if (search) {
        const results = await webSearch(search.provider, search.key, section.query, { count: PER_SECTION, signal, fetch: deps.fetch }).catch((err) => {
          // A failed search leaves this section to the model rather than stopping the whole syllabus.
          if (signal.aborted) throw err;
          return [];
        });
        found = results.map((r) => {
          const known = sources.findIndex((s) => s.url === r.url);
          return { n: (known === -1 ? sources.push(r) : known + 1), r };
        });
      }
      const prompt = [
        `Syllabus: ${outline.title}\nLearner's request: ${topic}`,
        `Sections in order: ${outline.sections.map((s) => s.title).join("; ")}`,
        `Write section ${i + 1}: ${section.title}\nIt must cover: ${section.covers || section.title}`,
        found.length ? `Sources:\n${found.map(({ n, r }) => `[${n}] ${r.title} (${r.url})\n${r.snippet}`).join("\n\n")}` : "",
      ].filter(Boolean).join("\n\n");
      const text = await complete(deps, { slot: "strong", role: "researcher", folderId, system: `${WRITE}\n${found.length ? CITE : OWN}`, prompt, maxTokens: 3500, signal });
      parts.push(text.trim().startsWith("## ") ? text.trim() : `## ${section.title}\n\n${text.trim()}`);
    }
    progress(total, total);

    const webbed = sources.length > 0;
    const note = webbed
      ? `> Written by Distil's researcher from ${sources.length} web sources found with ${SEARCH_LABEL[search!.provider]}. Numbers in brackets point to the sources at the end.`
      : "> Generated by Distil's researcher from the model's own knowledge, with no sources. Check anything important against a textbook or your course.";
    const md = [`# ${outline.title}`, note, ...parts, ...(webbed ? [`## Sources\n\n${sources.map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})`).join("\n")}`] : [])].join("\n\n") + "\n";
    const name = `${outline.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 140)} (${webbed ? "researched" : "generated"}).md`;
    const material = deps.materials.add(folderId, name, new TextEncoder().encode(md));
    deps.jobs.enqueue("parse", parseLabel(material.name), { folderId, materialId: material.id });
  }

  deps.jobs.register("research", async (job, { signal, progress }) => {
    if (!job.folderId) throw new AppError(400, "no_folder", "Research needs a folder.");
    await run(job.folderId, String(job.params.topic ?? ""), signal, progress);
  });

  return { start, searchReady: () => searchKey()?.provider ?? null };
}

export type Researcher = ReturnType<typeof createResearcher>;
