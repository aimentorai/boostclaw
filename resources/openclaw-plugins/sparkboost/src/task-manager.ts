/**
 * Generic Async Task Manager
 *
 * Manages long-running async tasks (video gen, image gen, etc.) using
 * declarative task type adapters. Handles submit, poll, persist, and
 * proactive notification via OpenClaw system events + heartbeat.
 */
import { SparkBoostClient } from "./sparkboost-client";
import { getByPath, TASK_TYPES, type AsyncTask, type TaskStatus } from "./task-adapters";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";

const STATE_FILE = "tasks.json";
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_COUNT = 120;
const PERSIST_INTERVAL_MS = 60_000;
/** Minimal surface of api.runtime that we need for notifications. */
export interface RuntimeApi {
  subagent: {
    run: (params: {
      sessionKey: string;
      message: string;
      deliver?: boolean;
      extraSystemPrompt?: string;
      idempotencyKey?: string;
    }) => Promise<{ runId: string }>;
  };
  system: {
    enqueueSystemEvent: (text: string, options: { sessionKey: string; contextKey?: string | null }) => boolean;
    requestHeartbeatNow: (opts?: { reason?: string; coalesceMs?: number; agentId?: string; sessionKey?: string }) => void;
  };
}

interface TaskState {
  tasks: Record<string, AsyncTask>;
  notifiedTaskIds?: string[];
}

export class SparkBoostTaskManager {
  private tasks = new Map<string, AsyncTask>();
  private client: SparkBoostClient;
  private stateDir: string;
  private runtimeApi: RuntimeApi | null = null;
  private notifiedTasks = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(client: SparkBoostClient, stateDir: string) {
    this.client = client;
    this.stateDir = stateDir;
  }

  /** Inject the runtime API for notifications. Called once after register(). */
  setRuntimeApi(api: RuntimeApi): void {
    this.runtimeApi = api;
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

  /** Submit a new async task. Type must match a key in TASK_TYPES. */
  async submit(
    type: string,
    params: Record<string, unknown>,
    sessionKey?: string,
  ): Promise<AsyncTask> {
    const adapter = TASK_TYPES[type];
    if (!adapter) throw new Error(`Unknown task type: ${type}`);

    const body = adapter.submitParams(params);
    const raw = await this.client.post(adapter.submitPath, body);
    const json = JSON.parse(raw);
    const apiTaskId = getByPath(json, adapter.taskIdKey);
    if (!apiTaskId) {
      throw new Error(`[${type}] submit returned no task ID: ${raw.slice(0, 200)}`);
    }

    const task: AsyncTask = {
      taskId: String(apiTaskId),
      type,
      status: "submitted",
      params,
      sessionKey: sessionKey ?? undefined,
      submittedAt: Date.now(),
      pollCount: 0,
    };
    this.tasks.set(task.taskId, task);
    await this.persist();

    // No submit notification — the tool response already confirms submission.
    // subagent.run on submit would block the session lane and cause double registration.

    return { ...task };
  }

  getStatus(taskId: string): AsyncTask | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  listTasks(status?: TaskStatus): AsyncTask[] {
    const all = Array.from(this.tasks.values());
    if (status) return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    return all.map((t) => ({ ...t }));
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === "succeeded" || task.status === "failed") return false;
    this.tasks.set(taskId, {
      ...task,
      status: "failed",
      error: "Cancelled by user",
      completedAt: Date.now(),
    });
    void this.persist();
    return true;
  }

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

  // --- Private ---

  private async poll(): Promise<void> {
    const pending = Array.from(this.tasks.values()).filter(
      (t) => t.status === "submitted" || t.status === "processing",
    );
    if (pending.length === 0) return;

    // Group by type for efficient adapter lookup
    const byType = new Map<string, AsyncTask[]>();
    for (const task of pending) {
      let list = byType.get(task.type);
      if (!list) { list = []; byType.set(task.type, list); }
      list.push(task);
    }

    for (const [type, tasks] of byType) {
      const adapter = TASK_TYPES[type];
      if (!adapter) continue;
      for (const task of tasks) {
        if (task.pollCount >= MAX_POLL_COUNT) {
          this.tasks.set(task.taskId, {
            ...task,
            status: "failed",
            error: `Timed out after ${MAX_POLL_COUNT} polls`,
            completedAt: Date.now(),
          });
          this.notifyCompletion(this.tasks.get(task.taskId)!);
          continue;
        }
        try {
          const raw = adapter.pollMethod === "GET"
            ? await this.client.get(adapter.pollPath(task.taskId))
            : await this.client.post(adapter.pollPath(task.taskId), adapter.pollBody?.(task.taskId));
          const json = JSON.parse(raw);
          const rawStatus = getByPath(json, adapter.statusPath ?? "data.status");
          const mapped = adapter.statusMap[String(rawStatus)] ?? "processing";

          const updated: AsyncTask = { ...task, pollCount: task.pollCount + 1 };

          if (mapped === "succeeded") {
            updated.status = "succeeded";
            updated.resultUrl = String(getByPath(json, adapter.resultKey) ?? "");
            updated.completedAt = Date.now();
            this.tasks.set(task.taskId, updated);
            this.notifyCompletion(updated);
          } else if (mapped === "failed") {
            updated.status = "failed";
            const rawError = adapter.errorKey ? getByPath(json, adapter.errorKey) : null;
            updated.error = String(rawError ?? "Unknown error");
            updated.completedAt = Date.now();
            this.tasks.set(task.taskId, updated);
            this.notifyCompletion(updated);
          } else {
            updated.status = "processing";
            this.tasks.set(task.taskId, updated);
          }
        } catch (err) {
          this.tasks.set(task.taskId, { ...task, pollCount: task.pollCount + 1 });
          console.error(`[sparkboost] poll failed for task=${task.taskId}:`, err);
        }
      }
    }
    await this.persist();
  }

  private notifyCompletion(task: AsyncTask): void {
    // Deduplicate: only notify once per task across restarts
    if (this.notifiedTasks.has(task.taskId)) return;
    this.notifiedTasks.add(task.taskId);

    console.error(`[sparkboost] notifyCompletion: task=${task.taskId} status=${task.status} sessionKey=${task.sessionKey ?? "(none)"} runtimeApi=${this.runtimeApi ? "yes" : "NO"}`);
    if (!task.sessionKey || !this.runtimeApi) return;

    const prompt = task.status === "succeeded"
      ? `[${task.type}] 视频生成完成!\nTask ID: ${task.taskId}\n视频链接: ${task.resultUrl}\n\n请告知用户视频已生成完成，并提供视频链接。`
      : `[${task.type}] 视频生成失败\nTask ID: ${task.taskId}\n错误: ${task.error}\n\n请告知用户视频生成失败，并提供错误信息。`;

    this.runtimeApi.subagent.run({
      sessionKey: task.sessionKey,
      message: prompt,
      deliver: true,
      extraSystemPrompt: "你是一个任务通知助手。请用简洁的中文通知用户任务的完成状态。直接输出通知内容，不要添加额外解释。",
      idempotencyKey: `sparkboost-${task.taskId}-notify`,
    }).catch((err: unknown) => {
      console.error(`[sparkboost] subagent.run failed for ${task.taskId}:`, err);
    });
  }

  private async persist(): Promise<void> {
    try {
      if (!existsSync(this.stateDir)) {
        await mkdir(this.stateDir, { recursive: true });
      }
      const state: TaskState = {
        tasks: {},
        notifiedTaskIds: Array.from(this.notifiedTasks),
      };
      for (const [id, task] of this.tasks) {
        state.tasks[id] = task;
      }
      const tmpPath = join(this.stateDir, STATE_FILE + ".tmp");
      const finalPath = join(this.stateDir, STATE_FILE);
      await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
      await rename(tmpPath, finalPath);
    } catch (err) {
      console.error('[sparkboost] task state persist failed:', err);
    }
  }

  private async restore(): Promise<void> {
    try {
      const filePath = join(this.stateDir, STATE_FILE);
      if (!existsSync(filePath)) return;
      const raw = await readFile(filePath, "utf-8");
      const state = JSON.parse(raw) as TaskState;
      if (!state || typeof state.tasks !== 'object') {
        console.warn('[sparkboost] tasks.json has invalid format, starting fresh');
        return;
      }
      for (const [id, task] of Object.entries(state.tasks || {})) {
        if (task.status === "submitted" || task.status === "processing") {
          this.tasks.set(id, task);
        }
      }
      // Restore notified set to prevent duplicate notifications
      if (Array.isArray(state.notifiedTaskIds)) {
        for (const id of state.notifiedTaskIds) {
          this.notifiedTasks.add(id);
        }
      }
    } catch (err) {
      console.warn('[sparkboost] state restore failed, starting fresh:', err);
    }
  }
}
