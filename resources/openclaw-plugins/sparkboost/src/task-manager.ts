/**
 * SparkBoost Async Task Manager
 *
 * Background service that manages long-running video generation tasks.
 * Submits jobs via the API, polls for completion in the background,
 * and persists state for crash recovery.
 *
 * Runs inside the OpenClaw Gateway process via api.registerService().
 */
import { SparkBoostClient } from "./sparkboost-client";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const GROK_SUBMIT = "/grokImagine/submit";
const GROK_RESULT = "/grokImagine/result";
const STATE_FILE = "tasks.json";
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_COUNT = 120; // 30s * 120 = 60 min max wait
const PERSIST_INTERVAL_MS = 60_000;

export interface VideoTask {
  taskId: string;
  status: "submitted" | "processing" | "succeeded" | "failed";
  prompt: string;
  duration: number;
  aspectRatio: string;
  submittedAt: number;
  completedAt?: number;
  videoUrl?: string;
  error?: string;
  pollCount: number;
}

interface TaskState {
  tasks: Record<string, VideoTask>;
}

export class SparkBoostTaskManager {
  private tasks = new Map<string, VideoTask>();
  private client: SparkBoostClient;
  private stateDir: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(client: SparkBoostClient, stateDir: string) {
    this.client = client;
    this.stateDir = stateDir;
  }

  async start(): Promise<void> {
    await this.restore();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.persistTimer = setInterval(() => void this.persist(), PERSIST_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    await this.persist();
  }

  /**
   * Submit a video generation task. Returns immediately with a tracking ID.
   * The background poll loop will update the task status.
   */
  async submit(params: {
    prompt: string;
    duration: number;
    aspectRatio: string;
    imageUrls?: string[];
  }): Promise<VideoTask> {
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      duration: params.duration,
      aspect_ratio: params.aspectRatio,
    };
    if (params.imageUrls && params.imageUrls.length > 0) {
      body.image_urls = params.imageUrls;
    }

    const raw = await this.client.post(GROK_SUBMIT, body);
    const json = JSON.parse(raw);
    const apiTaskId = json.data?.id || json.data?.taskId || json.taskId;

    if (!apiTaskId) {
      throw new Error(`Grok submit returned no task ID: ${raw.slice(0, 200)}`);
    }

    const task: VideoTask = {
      taskId: String(apiTaskId),
      status: "submitted",
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      submittedAt: Date.now(),
      pollCount: 0,
    };

    this.tasks.set(task.taskId, task);
    await this.persist();
    return { ...task };
  }

  /**
   * Get the current status of a task.
   * Returns null if the task ID is unknown.
   */
  getStatus(taskId: string): VideoTask | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  /**
   * List all tasks, optionally filtered by status.
   */
  listTasks(status?: VideoTask["status"]): VideoTask[] {
    const all = Array.from(this.tasks.values());
    if (status) return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    return all.map((t) => ({ ...t }));
  }

  /**
   * Cancel a pending task.
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === "succeeded" || task.status === "failed") return false;
    task.status = "failed";
    task.error = "Cancelled by user";
    task.completedAt = Date.now();
    void this.persist();
    return true;
  }

  /**
   * Remove completed/failed tasks older than the given number of hours.
   */
  prune(maxAgeHours: number = 24): number {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let pruned = 0;
    for (const [id, task] of this.tasks) {
      if ((task.status === "succeeded" || task.status === "failed") && task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) void this.persist();
    return pruned;
  }

  /**
   * Background poll loop. Checks all non-terminal tasks.
   */
  private async poll(): Promise<void> {
    const pending = Array.from(this.tasks.values()).filter(
      (t) => t.status === "submitted" || t.status === "processing"
    );

    for (const task of pending) {
      if (task.pollCount >= MAX_POLL_COUNT) {
        task.status = "failed";
        task.error = `Timed out after ${MAX_POLL_COUNT} polls (${Math.round(MAX_POLL_COUNT * POLL_INTERVAL_MS / 60000)} min)`;
        task.completedAt = Date.now();
        continue;
      }

      try {
        const raw = await this.client.get(`${GROK_RESULT}?id=${encodeURIComponent(task.taskId)}`);
        const json = JSON.parse(raw);
        const data = json.data || json;
        const apiStatus = data.status;

        task.pollCount++;

        if (apiStatus === 2 || apiStatus === "success") {
          task.status = "succeeded";
          task.videoUrl = data.video_url || data.videoUrl || data.url;
          task.completedAt = Date.now();
        } else if (apiStatus === 3 || apiStatus === "failed") {
          task.status = "failed";
          task.error = data.reason || data.message || "Video generation failed";
          task.completedAt = Date.now();
        } else {
          task.status = "processing";
        }
      } catch {
        task.pollCount++;
        // Don't fail on transient poll errors — just skip this round
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      if (!existsSync(this.stateDir)) {
        await mkdir(this.stateDir, { recursive: true });
      }
      const state: TaskState = { tasks: {} };
      for (const [id, task] of this.tasks) {
        state.tasks[id] = task;
      }
      await writeFile(join(this.stateDir, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
    } catch {
      // Best effort — don't crash the service on persist failure
    }
  }

  private async restore(): Promise<void> {
    try {
      const filePath = join(this.stateDir, STATE_FILE);
      if (!existsSync(filePath)) return;
      const raw = await readFile(filePath, "utf-8");
      const state = JSON.parse(raw) as TaskState;
      for (const [id, task] of Object.entries(state.tasks || {})) {
        // Only restore non-terminal tasks (submitted/processing)
        if (task.status === "submitted" || task.status === "processing") {
          this.tasks.set(id, task);
        }
      }
    } catch {
      // Corrupted state file — start fresh
    }
  }
}
