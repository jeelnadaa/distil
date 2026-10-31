import { z } from "zod";

// Shapes shared by the learning phases (plan, teach, practice, retention). Phase 3 compiles and stores
// the brief; every other mode reads it (F-104, F-105).

export const Depth = z.enum(["survey", "standard", "exam_ready", "mastery"]);
export const Brief = z.object({
  goal: z.string().min(1).max(300),
  scope: z.string().max(600).default(""),
  level: z.string().max(300).default(""),
  depth: Depth.default("standard"),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  hoursPerDay: z.number().positive().max(24).nullable().default(null),
  daysOff: z.array(z.number().int().min(0).max(6)).default([]),
  assessment: z.string().max(300).default(""),
  language: z.string().max(40).default("English"),
});
export type Brief = z.infer<typeof Brief>;

export const ITEM_STATUSES = ["pending", "planned", "taught", "checked", "mastered"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const EVENT_KINDS = ["taught", "probe", "check", "practice", "exam", "review"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Confidence = "guess" | "unsure" | "sure";
export type ItemEvent = {
  itemId: string; kind: EventKind; score?: number | null; confidence?: Confidence | null; withHelp?: boolean;
  chatId?: string | null; messageId?: string | null; ref?: string | null;
};
export type ChatMode = "ask" | "teach" | "practice" | "exam";
export type Provenance = "material" | "extra" | "generated";
