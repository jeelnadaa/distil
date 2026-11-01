import { complete, type LlmDeps } from "../llm.ts";
import { fencedBlocks } from "./blocks.ts";
import { type GrammarLang, isGrammar, parseWidget, SAMPLES } from "./grammar/index.ts";

// Repair (F-758): a widget block that doesn't parse gets one short call on the cheap slot carrying the
// block, the parser's error and that grammar's sample, nothing else from the chat. A block still invalid
// afterwards stays as it was; the reply shows it as readable text with "Couldn't draw this".

const REPAIR_SYSTEM = `You fix one widget block that failed to parse. Keep its meaning and content; change only what the error needs.
Reply with only the corrected block body: no fences, no explanation.`;

export async function repairVisuals(deps: LlmDeps, text: string, folderId: string | null, signal?: AbortSignal): Promise<string> {
  const broken = fencedBlocks(text).flatMap((b) => {
    if (!b.closed || !isGrammar(b.lang)) return [];
    const parsed = parseWidget(b.lang, b.source);
    return parsed.ok ? [] : [{ ...b, error: parsed.error }];
  });
  if (!broken.length) return text;
  const fixed = await Promise.all(broken.map(async (b) => {
    const sample = (SAMPLES as Record<string, string>)[b.lang];
    const prompt = [
      `Language: ${b.lang}`,
      sample ? `A valid example of this language:\n${sample}` : "",
      `The block:\n${b.source}`,
      `Parser error: ${b.error}`,
    ].filter(Boolean).join("\n\n");
    try {
      const reply = (await complete(deps, { slot: "cheap", role: "visuals", folderId, system: REPAIR_SYSTEM, prompt, maxTokens: 1500, signal }))
        .trim().replace(/^```[\w-]*\n?|\n?```$/g, "");
      return parseWidget(b.lang as GrammarLang, reply).ok ? reply : null;
    } catch {
      return null;
    }
  }));
  // Replaced from the end so earlier offsets stay valid.
  let out = text;
  for (let i = broken.length - 1; i >= 0; i--) {
    const b = broken[i]!;
    const body = fixed[i];
    if (body !== null && body !== undefined) out = `${out.slice(0, b.start)}\`\`\`${b.lang}\n${body}\n\`\`\`${out.slice(b.end)}`;
  }
  return out;
}
