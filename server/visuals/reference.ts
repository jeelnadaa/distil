// The grammar reference a model gets in its system prompt (F-757). About 400 tokens, sent only when the
// interactivity dial allows visuals, and the same text for every turn at a given dial so it can sit in
// the static prompt prefix where provider prompt caching makes repeats cheap.

import { SAMPLES } from "./grammar/index.ts";

export const DIALS = ["text", "balanced", "visual"] as const;
export type Dial = (typeof DIALS)[number];
export const DIAL_LABELS: Record<Dial, string> = { text: "Text-only", balanced: "Balanced", visual: "Visual-heavy" };

// F-742: what each dial setting asks of the model.
const WHEN: Record<Exclude<Dial, "text">, string> = {
  balanced: "Add a visual only when the idea is dynamic, spatial or a process and a picture clearly beats prose; most answers need none.",
  visual: "Prefer a visual for every step or idea where one fits.",
};

const block = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

const REFERENCE = `These fenced blocks render as widgets:
${block("flow", SAMPLES.flow)}
Nodes a[box] b{decision} c(end); arrows -> -label-> ~>; "dir: LR".
${block("plot", SAMPLES.plot)}
Also "y: -2..2", "point (1, 2) label"; maths: + - * / ^ sin exp ln sqrt pi.
${block("chart", SAMPLES.chart)}
type: bar|line|scatter; "x: label", "y: label"; - is missing.
${block("steps", SAMPLES.steps)}
${block("compare", SAMPLES.compare)}
${block("timeline", SAMPLES.timeline)}
${block("quiz", SAMPLES.quiz)}
"1. step" lines make an ordering question.
${block("formula", SAMPLES.formula)}
${block("map", SAMPLES.map)}
A block opened with \`\`\`js run is editable, runnable JavaScript; console.log prints.
An \`\`\`app block holds a short brief for a simulation or explorable, which is built for you; a \`\`\`figure block holds a brief for a precise labelled diagram.
Style is semantic only: "!" marks the one key element, "~" mutes, tone=good|warn|bad, series=1…6. Never colours, fonts, sizes, CSS or HTML. Optional first line "title: …"; labels may use $maths$.`;

// A learner asking for a picture outright, which Text-only still honours (F-742).
const ASKS_FOR_VISUAL = /\b(diagram|draw|sketch|chart|plot|graph|visual(?:ise|ize)?|flow ?chart|mind ?map|concept map|timeline|simulat\w*|animat\w*|interactive|widget|quiz me)\b/i;
export const asksForVisual = (text: string) => ASKS_FOR_VISUAL.test(text);

// Ask and Teach put this in their system prompts, right after the fixed instructions so it stays in the
// cacheable prefix. Text-only sends it only for a turn whose request asks for a visual.
export function widgetPromptReference(dial: Dial, request = ""): string {
  if (dial === "text" && !asksForVisual(request)) return "";
  const when = dial === "text" ? "The learner set visuals to Text-only: draw only what they explicitly asked for." : WHEN[dial];
  return `## Visuals\n${when} If the learner asks for fewer or more visuals, follow that for the rest of the chat.\n${REFERENCE}`;
}
