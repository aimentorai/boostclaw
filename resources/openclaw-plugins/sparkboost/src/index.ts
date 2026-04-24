/**
 * SparkBoost OpenClaw Plugin
 *
 * Two-layer architecture:
 * - Tools: Fine-grained API layer (hidden behind skills)
 * - Skills: UX/routing layer (what users see)
 *
 * All tools use factory function pattern for sessionKey access.
 * Async video generation uses declarative task adapters (task-adapters.ts).
 * Completion notifications via OpenClaw system events + heartbeat.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { join } from "path";
import { SparkBoostClient } from "./sparkboost-client";
import { SparkBoostTaskManager } from "./task-manager";
import { type AsyncTask } from "./task-adapters";
import { wrapResponse, wrapError } from "./trust-boundary";

const TIKTOK_AUTH_LIST = "/api/v1/openapi/tiktok/auth/list";
const TIKTOK_PRODUCT_LIST = "/api/v1/openapi/tiktok/product/list";
const TIKTOK_VIDEO_PUBLISH = "/api/v1/openapi/tiktok/video/publish";
const TIKTOK_VIDEO_STATUS = "/api/v1/openapi/tiktok/video/status";
const TIKTOK_VIDEO_PRECHECK = "/api/v1/openapi/tiktok/video/precheck";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}

interface ToolContext {
  sessionKey?: string;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], ...(details ? { details } : {}) };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }] };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface PluginApi {
  pluginConfig: Record<string, unknown>;
  logger: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
  registerTool(tool: unknown, meta: unknown): void;
  runtime?: {
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
  };
}

interface SparkBoostConfig {
  secretKey?: string;
  apiKey?: string;
  baseUrl?: string;
}

export default definePluginEntry({
  id: "sparkboost",
  name: "SparkBoost",
  description: "TikTok video publishing and Grok AI video generation tools",
  kind: "tool",
  configSchema: Type.Object({
    secretKey: Type.String({ description: "SparkBoost API secret key" }),
    apiKey: Type.String({ description: "SparkBoost X-Api-Key" }),
    baseUrl: Type.Optional(Type.String({
      description: "API gateway URL",
      default: "http://gateway.microdata-inc.com",
    })),
  }),
  register(api) {
    const typedApi = api as unknown as PluginApi;
    const cfg = typedApi.pluginConfig as SparkBoostConfig;
    const secretKey = cfg.secretKey || process.env.SPARKBOOST_SECRET_KEY || "";
    const apiKey = cfg.apiKey || process.env.SPARKBOOST_API_KEY || "";
    const baseUrl = cfg.baseUrl || "http://gateway.microdata-inc.com";

    if (!secretKey || !apiKey) {
      typedApi.logger?.warn?.("sparkboost: missing secretKey and apiKey — plugin will not function.");
      return;
    }

    const client = new SparkBoostClient({ secretKey, apiKey, baseUrl });

    const stateDir = join(
      process.env.OPENCLAW_STATE_DIR || join(process.env.HOME || "/tmp", ".openclaw"),
      "sparkboost",
    );
    const taskManager = new SparkBoostTaskManager(client, stateDir);

    // Inject runtime API (subagent + system) for proactive notifications
    const runtime = typedApi.runtime;
    if (runtime) {
      taskManager.setRuntimeApi(runtime);
      console.error("[sparkboost] RuntimeApi injected (subagent+system), notifications enabled");
    } else {
      console.error("[sparkboost] WARN: api.runtime not available — completion notifications DISABLED");
    }

    taskManager.start().catch((err: unknown) => {
      typedApi.logger?.warn?.("sparkboost: task manager start failed:", err);
    });
    typedApi.logger?.info?.("sparkboost: plugin registered, task manager initialized");
    console.error("[sparkboost] plugin registered, version 0.4.0+diag");

    // --- Tool 1: List TikTok accounts ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_list_accounts",
      label: "List TikTok Accounts",
      description:
        "List all authorized TikTok accounts. Returns account IDs, nicknames, status. " +
        "Use this first to get authId before publishing videos.",
      parameters: Type.Object({}),
      async execute(): Promise<ToolResult> {
        try {
          const raw = await client.post(TIKTOK_AUTH_LIST);
          return textResult(wrapResponse(raw, "tiktok/auth/list"));
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "tiktok/auth/list"));
        }
      },
    }), { name: "sparkboost_list_accounts" });

    // --- Tool 2: List showcase products ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_list_products",
      label: "List Showcase Products",
      description:
        "List showcase (橱窗) products for a TikTok account. " +
        "Returns product IDs, titles, prices, sales counts. Paginated.",
      parameters: Type.Object({
        authId: Type.String({ description: "TikTok authorization ID (from list_accounts)" }),
        pageSize: Type.Optional(Type.Number({ description: "Items per page (1-20, default 20)", minimum: 1, maximum: 20 })),
        pageToken: Type.Optional(Type.String({ description: "Pagination token from previous response" })),
      }),
      async execute(_id, params): Promise<ToolResult> {
        const body: Record<string, unknown> = { authId: params.authId };
        if (params.pageSize) body.pageSize = params.pageSize;
        if (params.pageToken) body.pageToken = params.pageToken;
        try {
          const raw = await client.post(TIKTOK_PRODUCT_LIST, body);
          return textResult(wrapResponse(raw, "tiktok/product/list"));
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "tiktok/product/list"));
        }
      },
    }), { name: "sparkboost_list_products" });

    // --- Tool 3: Publish video ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_publish",
      label: "Publish TikTok Video",
      description:
        "Publish a video to a TikTok account. Returns a publishTaskId for tracking. " +
        "This is an IRREVERSIBLE operation. Always confirm with user before calling.",
      parameters: Type.Object({
        authId: Type.String({ description: "TikTok authorization ID" }),
        videoUrl: Type.String({ description: "Publicly accessible video URL" }),
        videoTitle: Type.String({ description: "Video title (max 2200 chars)" }),
        productId: Type.String({ description: "Product ID to link" }),
        productAnchorTitle: Type.String({ description: "Product anchor text (max 30 chars)" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        try {
          const raw = await client.post(TIKTOK_VIDEO_PUBLISH, {
            authId: params.authId,
            videoUrl: params.videoUrl,
            videoTitle: params.videoTitle,
            productId: params.productId,
            productAnchorTitle: params.productAnchorTitle,
          });
          return textResult(wrapResponse(raw, "tiktok/video/publish"));
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "tiktok/video/publish"));
        }
      },
    }), { name: "sparkboost_publish" });

    // --- Tool 4: Check publish status ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_check_status",
      label: "Check Publish Status",
      description:
        "Check the status of a video publish task. " +
        "Returns PROCESSING, SUCCESS, or FAILED with details.",
      parameters: Type.Object({
        publishTaskId: Type.String({ description: "Task ID from sparkboost_publish response" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        try {
          const raw = await client.post(TIKTOK_VIDEO_STATUS, {
            publishTaskId: params.publishTaskId,
          });
          return textResult(wrapResponse(raw, "tiktok/video/status"));
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "tiktok/video/status"));
        }
      },
    }), { name: "sparkboost_check_status" });

    // --- Tool 5: Submit Grok video task (async) ---
    typedApi.registerTool((ctx: ToolContext) => ({
      name: "sparkboost_grok_submit",
      label: "Submit Grok Video Task",
      description:
        "Submit an AI video generation task via Grok. Returns IMMEDIATELY with a task ID. " +
        "Video generation typically takes 5-8 minutes. " +
        "Use sparkboost_grok_task_status to check progress.",
      parameters: Type.Object({
        prompt: Type.String({ description: "Video generation prompt" }),
        duration: Type.Number({ description: "Video duration in seconds (6 or 10)", enum: [6, 10] }),
        aspect_ratio: Type.String({
          description: "Aspect ratio",
          enum: ["2:3", "3:2", "1:1", "16:9", "9:16"],
        }),
        image_urls: Type.Optional(Type.Array(Type.String(), {
          description: "Reference image URLs for image-to-video generation",
        })),
      }),
      async execute(_id, params): Promise<ToolResult> {
        try {
          console.error("[sparkboost] grok_submit: sessionKey =", ctx.sessionKey ?? "(none)");
          const task = await taskManager.submit(
            "grok-video",
            {
              prompt: params.prompt as string,
              duration: params.duration as number,
              aspectRatio: params.aspect_ratio as string,
              imageUrls: params.image_urls as string[] | undefined,
            },
            ctx.sessionKey,
          );
          const promptText = String(task.params?.prompt ?? "");
          const summary = [
            `Video generation task submitted.`,
            `Task ID: ${task.taskId}`,
            `Status: ${task.status}`,
            `Prompt: "${promptText.slice(0, 80)}${promptText.length > 80 ? "..." : ""}"`,
            `Duration: ${task.params?.duration}s | Aspect: ${task.params?.aspect_ratio}`,
            ``,
            `Video generation typically takes 5-8 minutes.`,
            `Use sparkboost_grok_task_status to check progress.`,
          ].join("\n");
          return textResult(
            wrapResponse(summary, "grokImagine/submit"),
            { taskId: task.taskId, status: task.status },
          );
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "grokImagine/submit"));
        }
      },
    }), { name: "sparkboost_grok_submit" });

    // --- Tool 6: Query Grok task status ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_grok_task_status",
      label: "Query Grok Task Status",
      description:
        "Check the status of an async video generation task submitted via sparkboost_grok_submit. " +
        "Returns submitted/processing/succeeded/failed. If succeeded, includes videoUrl. " +
        "This checks the local task registry — no API call needed.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ID from sparkboost_grok_submit" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        const task = taskManager.getStatus(params.taskId as string);
        if (!task) {
          return errorResult(`Task not found: ${params.taskId}. Check the task ID from sparkboost_grok_submit.`);
        }
        const promptText = String(task.params?.prompt ?? "");
        const lines = [
          `Task ID: ${task.taskId}`,
          `Status: ${task.status}`,
          `Prompt: "${promptText.slice(0, 80)}${promptText.length > 80 ? "..." : ""}"`,
          `Poll count: ${task.pollCount}`,
          `Elapsed: ${Math.round((Date.now() - task.submittedAt) / 1000)}s`,
        ];
        if (task.status === "succeeded" && task.resultUrl) {
          lines.push(`Video URL: ${task.resultUrl}`);
        }
        if (task.status === "failed" && task.error) {
          lines.push(`Error: ${task.error}`);
        }
        return textResult(lines.join("\n"), {
          taskId: task.taskId,
          status: task.status,
          videoUrl: task.resultUrl,
        });
      },
    }), { name: "sparkboost_grok_task_status" });

    // --- Tool 7: List all Grok tasks ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_grok_task_list",
      label: "List Grok Tasks",
      description:
        "List all video generation tasks and their statuses. " +
        "Useful for checking batch progress or finding completed videos.",
      parameters: Type.Object({
        status: Type.Optional(Type.String({
          description: "Filter by status: submitted, processing, succeeded, failed",
          enum: ["submitted", "processing", "succeeded", "failed"],
        })),
      }),
      async execute(_id, params): Promise<ToolResult> {
        const tasks = taskManager.listTasks(params.status as AsyncTask["status"] | undefined);
        if (tasks.length === 0) {
          return textResult("No video generation tasks found.");
        }
        const lines = tasks.map((t, i) => {
          const elapsed = Math.round((Date.now() - t.submittedAt) / 1000);
          const promptText = String(t.params?.prompt ?? "");
          const suffix = t.status === "succeeded" && t.resultUrl ? ` → ${t.resultUrl.slice(0, 60)}...` : "";
          return `${i + 1}. [${t.status.toUpperCase()}] ${t.taskId} (${elapsed}s) "${promptText.slice(0, 40)}..."${suffix}`;
        });
        return textResult(
          `Video tasks (${tasks.length}):\n${lines.join("\n")}`,
          { count: tasks.length },
        );
      },
    }), { name: "sparkboost_grok_task_list" });

    // --- Tool 8: Cancel a Grok task ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_grok_cancel",
      label: "Cancel Grok Task",
      description:
        "Cancel a pending or processing video generation task. " +
        "Completed tasks cannot be cancelled.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ID to cancel" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        const ok = taskManager.cancel(params.taskId as string);
        if (ok) {
          return textResult(`Task ${params.taskId} cancelled.`);
        }
        return errorResult(`Could not cancel task ${params.taskId} — not found or already completed.`);
      },
    }), { name: "sparkboost_grok_cancel" });

    // --- Tool 9: Composite snapshot ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_snapshot",
      label: "SparkBoost Status Snapshot",
      description:
        "Get a quick overview: all TikTok accounts with their status. " +
        "Use this as the first step when starting a new task to understand the current state.",
      parameters: Type.Object({}),
      async execute(): Promise<ToolResult> {
        try {
          const raw = await client.post(TIKTOK_AUTH_LIST);
          const json = JSON.parse(raw);
          const accounts = json.data || [];

          const summary = accounts
            .filter((a: any) => a.status === "ACTIVE")
            .map((a: any) => ({
              authId: a.authId,
              nickname: a.creatorNickname || a.shopName,
              type: a.creatorUserType || "shop",
            }));

          const summaryText = [
            `Active TikTok accounts: ${summary.length}`,
            ...summary.map((a: any, i: number) =>
              `  ${i + 1}. ${a.nickname} (${a.authId}) [${a.type}]`
            ),
          ].join("\n");

          return textResult(
            wrapResponse(summaryText, "snapshot"),
            { accountCount: summary.length },
          );
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "snapshot"));
        }
      },
    }), { name: "sparkboost_snapshot" });

    // --- Tool 10: Video compliance check ---
    typedApi.registerTool((_ctx: ToolContext) => ({
      name: "sparkboost_video_compliance",
      label: "Video Compliance Check",
      description:
        "Check if a generated video meets TikTok platform content standards. " +
        "Returns pass/fail with reason. Use before publishing auto-generated videos.",
      parameters: Type.Object({
        videoUrl: Type.String({ description: "Video URL to check for platform compliance" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        try {
          const raw = await client.post(TIKTOK_VIDEO_PRECHECK, {
            videoUrl: params.videoUrl,
          });
          const json = JSON.parse(raw);
          const data = json.data || {};
          const passed = data.pass === true || data.status === "PASS";
          const reason = data.reason || data.message || "";
          return textResult(
            wrapResponse(
              `Compliance check: ${passed ? "PASS" : "FAIL"}${reason ? ` — ${reason}` : ""}`,
              "video/compliance"
            ),
            { pass: passed, reason },
          );
        } catch (err: unknown) {
          return errorResult(wrapError(getErrorMessage(err), "video/compliance"));
        }
      },
    }), { name: "sparkboost_video_compliance" });
  },
});
