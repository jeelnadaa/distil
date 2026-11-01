// Study Plan agents (plan.md §4.1, §5): the Brief Compiler (cheap slot) and the Planner (strong slot).

export const BRIEF_SYSTEM = `You compile a Study Brief: what a learner wants from a subject, so every later step can follow it.
You get the learner's request (it may be short, vague or empty), the subject's materials, an outline of what they cover, and today's date.
Infer every field you can and give the rest a sensible default. Ask a question only for a field you cannot infer
that would change the plan (most often the exam date, the learner's level or the depth): at most 3 questions,
each with 2 to 4 short answer options that set the field.
Reply with only JSON:
{"brief":{"goal":"...","scope":"...","level":"...","depth":"survey|standard|exam_ready|mastery","deadline":"YYYY-MM-DD"|null,"hoursPerDay":number|null,"daysOff":[],"assessment":"...","language":"English"},
"kind":"course|skill",
"questions":[{"field":"goal|scope|level|depth|deadline|hoursPerDay|assessment","question":"...","options":[{"label":"...","value":...}]}]}
- goal: one specific sentence ("Pass the Statistics final, chapters 1 to 4"), never just the subject's name
- scope: which parts of the material count; level: what the learner already knows; assessment: how they will be tested
- daysOff: weekdays without study, 0 = Sunday to 6 = Saturday
- kind: "skill" for a practical skill or general goal (guitar chords, learning Rust), "course" for material to learn or an exam
- option values: a date YYYY-MM-DD for deadline (null for "no exam"), hours as a number for hoursPerDay, a depth word for depth, short text otherwise`;

const PLAN_REPLY = `Reply with only JSON:
{"units":[{"title":"...","summary":"one sentence","lessons":[{"key":"L1","title":"...","summary":"one sentence","kind":"lesson","minutes":30,"aids":["diagram"],"weight":1,"items":["i1","i2"],"after":[]}]}]}`;

export const PLAN_SYSTEM = `You plan a course of study from a coverage ledger: every item the learner must learn, in reading order.
Group the items into units and lessons. A lesson teaches a coherent set of items in one sitting (about 20 to 60 minutes,
usually 4 to 15 items, never more than 40), in a sensible teaching order. Units group related lessons.
Every item id must appear in at least one lesson; never invent ids. Keep the material's order unless a prerequisite must come first.
"after" lists the keys of lessons a lesson builds on: earlier lessons of this part, or the lessons from earlier parts listed for you.
"aids" suggests what would help: diagram, simulation, practice, example. Estimate "minutes" for the learner's depth.
${PLAN_REPLY}`;

export const EXAM_WEIGHTS = `Exam papers or a syllabus are included. Set each lesson's "weight" from them: 1 rarely or never examined, 2 examined, 3 heavily examined.`;
export const NO_WEIGHTS = `Set every lesson's "weight" to 1.`;

export const SKILL_PLAN = `This is a skill plan: units are milestones toward the goal, and each milestone ends with a project lesson
("kind":"project") where the learner applies what the milestone taught; a project needs no items.`;

export const SKILL_ONLY_PLAN = `There is no material: build the plan from the goal alone. Lessons have no items ("items":[]), so make each
lesson's summary say exactly what it covers. Units are milestones toward the goal, each ending with a project lesson ("kind":"project").`;
