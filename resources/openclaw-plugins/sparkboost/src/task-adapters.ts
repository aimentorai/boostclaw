/**
 * Declarative async task type definitions.
 *
 * Each adapter describes how to submit, poll, and parse results for one
 * category of long-running API (video generation, image generation, etc.).
 * New APIs only require adding an entry to TASK_TYPES.
 */

export interface AsyncTaskType {
  /** POST path for submitting a new task. */
  submitPath: string;
  /** Transform user-facing params into the API request body. */
  submitParams: (userParams: Record<string, unknown>) => Record<string, unknown>;
  /** HTTP method for polling. */
  pollMethod: "GET" | "POST";
  /** Build the poll URL (GET) or use pollBody (POST). */
  pollPath: (taskId: string) => string;
  /** Optional body builder for POST-based polling. */
  pollBody?: (taskId: string) => Record<string, unknown>;
  /** Dot-path to extract the task ID from the submit response (e.g. "data.id"). */
  taskIdKey: string;
  /** Dot-path to extract status from poll response. Defaults to "data.status". */
  statusPath?: string;
  /** Map raw API status values to canonical states. */
  statusMap: Record<string | number, "processing" | "succeeded" | "failed">;
  /** Dot-path to extract the result URL on success. */
  resultKey: string;
  /** Dot-path to extract an error message on failure. */
  errorKey?: string;
  /** Max wait time in minutes before auto-failing. */
  defaultTimeoutMin: number;
}

/**
 * Dot-path accessor for nested JSON objects.
 * getByPath({ data: { id: "abc" } }, "data.id") → "abc"
 */
export function getByPath(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Canonical status for any async task. */
export type TaskStatus = "submitted" | "processing" | "succeeded" | "failed";

/** A generic async task tracked by AsyncTaskManager. */
export interface AsyncTask {
  taskId: string;
  type: string;
  status: TaskStatus;
  params: Record<string, unknown>;
  sessionKey?: string;
  submittedAt: number;
  completedAt?: number;
  resultUrl?: string;
  error?: string;
  pollCount: number;
}

/**
 * Registry of all async task types.
 * Add a new API by appending an entry here — no other code changes needed.
 */
export const TASK_TYPES: Record<string, AsyncTaskType> = {
  "grok-video": {
    submitPath: "/grokImagine/submit",
    submitParams: (p) => ({
      prompt: p.prompt,
      duration: p.duration,
      aspect_ratio: p.aspectRatio,
      ...(p.imageUrls ? { image_urls: p.imageUrls } : {}),
    }),
    pollMethod: "GET",
    pollPath: (id) => `/grokImagine/result?id=${encodeURIComponent(id)}`,
    taskIdKey: "data.id",
    statusPath: "data.status",
    statusMap: { 0: "processing", 2: "succeeded", 3: "failed" },
    resultKey: "data.video_url",
    errorKey: "data.reason",
    defaultTimeoutMin: 60,
  },
  // Future APIs — uncomment and configure when available:
  //
  // "runway-video": {
  //   submitPath: "/runway/submit",
  //   submitParams: (p) => ({ prompt: p.prompt, model: p.model, duration: p.duration }),
  //   pollMethod: "POST",
  //   pollPath: () => "/runway/status",
  //   pollBody: (id) => ({ taskId: id }),
  //   taskIdKey: "data.taskId",
  //   statusMap: { PENDING: "processing", RUNNING: "processing", SUCCESS: "succeeded", FAILED: "failed" },
  //   resultKey: "data.output.url",
  //   errorKey: "data.error",
  //   defaultTimeoutMin: 30,
  // },
};
