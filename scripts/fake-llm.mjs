// A stand-in OpenAI-compatible server for manual testing: streams a canned reply slowly, then reports usage.
// Usage: node scripts/fake-llm.mjs [port]  (default 11999); add it as a custom provider in Settings › Providers.
import { createServer } from "node:http";

const REPLY = [
  "Terminal velocity is reached when **drag** balances **weight**.\n\n",
  "For quadratic drag, $F_d = \\tfrac12 \\rho C_d A v^2$, so setting $F_d = mg$ gives\n\n",
  "$$\nv_t = \\sqrt{\\frac{2mg}{\\rho C_d A}}\n$$\n\n",
  "| Object | $v_t$ (m/s) |\n|---|---|\n| Raindrop | 9 |\n| Skydiver | 55 |\n\n",
  "```python\nimport math\nv_t = math.sqrt(2 * 80 * 9.81 / (1.2 * 1.0 * 0.7))\n```\n",
];

const PORT = Number(process.argv[2] ?? 11999);

// Study Plan agents: a brief with one question, and a plan with one unit per section and lessons of 8 items,
// each after the one before it.
const brief = () => ({
  brief: { goal: "Pass the course exam", scope: "", level: "", depth: "exam_ready", deadline: null, hoursPerDay: 2, daysOff: [], assessment: "", language: "English" },
  kind: "course",
  questions: [{ field: "deadline", question: "When is the exam?", options: [
    { label: "In two weeks", value: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) },
    { label: "In a month", value: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) },
    { label: "No exam", value: null },
  ] }],
});
const plan = (prompt) => {
  const units = [];
  for (const line of prompt.split("\n")) {
    if (line.startsWith("## ")) units.push({ title: line.slice(3).split(" › ").at(-1).slice(0, 80), summary: "", ids: [] });
    const id = line.match(/^(i\d+) \[/)?.[1];
    if (id) (units.at(-1) ?? (units.push({ title: "Basics", summary: "", ids: [] }), units.at(-1))).ids.push(id);
  }
  let n = 0;
  return { units: units.map((u) => ({ title: u.title, summary: u.summary, lessons: Array.from({ length: Math.ceil(u.ids.length / 8) }, (_, i) => {
    const key = `L${++n}`;
    return { key, title: `${u.title.split(" ").slice(0, 4).join(" ")} ${i + 1}`, summary: "", kind: "lesson", minutes: 30, aids: i % 3 ? [] : ["diagram"], weight: 1, items: u.ids.slice(i * 8, i * 8 + 8), after: i ? [`L${n - 1}`] : [] };
  }) })) };
};

createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "fake-tutor", context_length: 32000 }, { id: "fake-namer" }] }));
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    const { messages } = JSON.parse(body);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const prompt = messages.at(-1).content;
    // Ledger agents (and the plan agents above, sent the same way): one item per sentence for extraction, nothing missed on audit, no merges.
    const ledger = /^You keep the record of a tutoring lesson/.test(system) ? { taught: [1], checked: [] } : /^You compile a Study Brief/.test(system) ? brief() : /^You plan a course of study/.test(system) ? plan(prompt) : /coverage ledger/i.test(system) ? (() => {
      if (/remove duplicates/i.test(system)) return { merges: [] };
      if (/audit/i.test(system)) return { missed: [] };
      const chunk = prompt.split("<chunk>")[1]?.split("</chunk>")[0] ?? "";
      const sentences = chunk.replace(/^#.*$/gm, "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 20);
      return { items: sentences.slice(0, 12).map((x) => ({ type: /=/.test(x) ? "formula" : "concept", title: x.split(" ").slice(0, 5).join(" ").replace(/[.,:;]$/, ""), statement: x, quote: x.split(" ").slice(0, 6).join(" ") })) };
    })() : null;
    const naming = !ledger && /title/i.test(system);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const parts = ledger ? [JSON.stringify(ledger)] : naming ? ["Terminal velocity of falling objects"] : REPLY.flatMap((p) => p.match(/.{1,12}/gs));
    for (const text of parts) {
      if (res.destroyed) return;
      send({ choices: [{ delta: { content: text } }] });
      await new Promise((r) => setTimeout(r, ledger ? 400 : naming ? 0 : 40));
    }
    send({ choices: [], usage: { prompt_tokens: 420, completion_tokens: naming ? 8 : 180 } });
    res.end("data: [DONE]\n\n");
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`fake llm on ${PORT}`));
