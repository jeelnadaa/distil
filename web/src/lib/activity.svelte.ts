// Background jobs for the activity dock (F-402): everything running, queued, or finished in the last
// day, across all folders. Polled quickly while something runs and slowly otherwise.
import { api, type Job } from "./api.ts";

export const activity = $state({ jobs: [] as Job[], open: false });

export const isActive = (j: Job) => j.status === "queued" || j.status === "running";
export const jobPct = (j: Job) => (j.total ? Math.round((j.done / j.total) * 100) : 0);
// An extraction that stopped (an error such as an exhausted quota, or the learner's Stop) picks up where it left off.
export const resumable = (j: Job) => j.kind === "extract" && (j.status === "error" || j.status === "aborted") && !!j.folderId && !!j.materialId;

const FAST_MS = 2000;
const SLOW_MS = 20000;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function refreshActivity() {
  clearTimeout(timer);
  try {
    activity.jobs = await api.jobs();
  } catch {
    // Offline or the server restarting: try again on the next tick.
  }
  timer = setTimeout(refreshActivity, activity.jobs.some(isActive) ? FAST_MS : SLOW_MS);
}

export async function stopJob(job: Job) {
  await api.abortJob(job.id);
  await refreshActivity();
}

export async function resumeJob(job: Job) {
  const p = job.params as { strategy?: "balanced" | "thorough" | "economy"; from?: number; to?: number };
  await api.extract(job.folderId!, { strategy: p.strategy ?? "balanced", materialId: job.materialId!, from: p.from, to: p.to });
  await refreshActivity();
}
