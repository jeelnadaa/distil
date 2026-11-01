import type { Brief } from "../learning/types.ts";
import { addDays, type Schedule } from "./schedule.ts";
import type { Plan } from "./store.ts";

// Plan export (F-509): Markdown (also the source of the printed PDF) and an .ics calendar of the schedule.

type ItemInfo = { title: string; type: string };
const STATUS: Record<string, string> = { todo: "", in_progress: " (in progress)", done: " (done)" };

export function planMarkdown(o: { title: string; plan: Plan; brief: Brief | null; items: Map<string, ItemInfo>; schedule: Schedule | null }): string {
  const { plan, brief, items, schedule } = o;
  const day = new Map(schedule?.days.flatMap((d) => d.lessons.map((id) => [id, d.date])) ?? []);
  const out = [`# ${o.title}: study plan`, ""];
  if (brief) {
    out.push(`**Goal:** ${brief.goal}  `);
    if (brief.deadline) out.push(`**Exam:** ${brief.deadline}${brief.hoursPerDay ? `, ${brief.hoursPerDay} h a day` : ""}  `);
    out.push(`**Depth:** ${brief.depth.replace("_", "-")}`, "");
  }
  const minutes = plan.lessons.reduce((n, l) => n + l.minutes, 0);
  out.push(`${plan.lessons.length} lessons in ${plan.units.length} units, about ${Math.round(minutes / 60)} hours.`, "");
  let n = 0;
  for (const unit of plan.units) {
    out.push(`## ${unit.title}`, "");
    if (unit.summary) out.push(unit.summary, "");
    for (const l of plan.lessons.filter((x) => x.unitId === unit.id)) {
      n++;
      const when = day.get(l.id) ? ` · ${day.get(l.id)}` : "";
      out.push(`### ${n}. ${l.title}${l.kind === "project" ? " (project)" : ""}${STATUS[l.status]}`, "", `~${l.minutes} min${when}${l.weight > 1 ? ` · exam weight ${l.weight}` : ""}`, "");
      if (l.summary) out.push(l.summary, "");
      for (const id of l.items) {
        const item = items.get(id);
        if (item) out.push(`- ${item.title} *(${item.type})*`);
      }
      if (l.items.length) out.push("");
    }
  }
  return out.join("\n");
}

// RFC 5545 text: escaped, CRLF line ends, long lines folded at 75 octets.
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}
const compact = (date: string) => date.replaceAll("-", "");

// One all-day event per day with work (study, mock exam, revision) plus the exam. stamp: when this export was made (UTC).
export function planIcs(o: { title: string; plan: Plan; schedule: Schedule; stamp: Date }): string {
  const titles = new Map(o.plan.lessons.map((l, i) => [l.id, `${i + 1}. ${l.title}`]));
  const stamp = o.stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Distil//Study plan//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escape(`${o.title} study plan`)}`];
  for (const d of o.schedule.days) {
    const lessons = d.lessons.map((id) => titles.get(id)!).filter(Boolean);
    const summary = d.kind === "exam" ? `Exam: ${o.title}` : d.kind === "mock" ? `Mock exam: ${o.title}` : d.kind === "revision" ? `Revision: ${o.title}`
      : lessons.length ? `Study ${o.title}: ${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}` : null;
    if (!summary) continue;
    lines.push("BEGIN:VEVENT", `UID:${o.plan.id}-${compact(d.date)}@distil`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`, `DTEND;VALUE=DATE:${compact(addDays(d.date, 1))}`, `SUMMARY:${escape(summary)}`);
    if (lessons.length) lines.push(`DESCRIPTION:${escape(lessons.join("\n"))}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
