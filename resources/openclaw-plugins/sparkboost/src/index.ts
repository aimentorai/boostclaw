/**
 * SparkBoost OpenClaw Plugin
 *
 * Registers native Tools for TikTok video publishing and Grok video generation.
 * Video generation is managed asynchronously via a background task service:
 * grok_submit returns immediately, the service polls in the background,
 * and grok_task_status / grok_task_list query the in-memory task registry.
 * All API responses are wrapped with trust boundary markers.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { SparkBoostClient } from "./sparkboost-client";
import { SparkBoostTaskManager } from "./task-manager";
import { wrapResponse, wrapError } from "./trust-boundary";

const TIKTOK_AUTH_LIST = "/api/v1/openapi/tiktok/auth/list";
const TIKTOK_PRODUCT_LIST = "/api/v1/openapi/tiktok/product/list";
const TIKTOK_VIDEO_PUBLISH = "/api/v1/openapi/tiktok/video/publish";
const TIKTOK_VIDEO_STATUS = "/api/v1/openapi/tiktok/video/status";
const GROK_RESULT = "/grokImagine/result";
const TIKTOK_VIDEO_PRECHECK = "/api/v1/openapi/tiktok/video/precheck";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], ...(details ? { details } : {}) };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }] };
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
    const cfg = (api as any).pluginConfig as { secretKey?: string; apiKey?: string; baseUrl?: string };
    const secretKey = cfg.secretKey || process.env.SPARKBOOST_SECRET_KEY || "";
    const apiKey = cfg.apiKey || process.env.SPARKBOOST_API_KEY || "";
    const baseUrl = cfg.baseUrl || "http://gateway.microdata-inc.com";

    if (!secretKey || !apiKey) {
      const logger = (api as any).logger;
      logger?.warn?.("sparkboost: missing secretKey and apiKey — plugin will not function. Set SPARKBOOST_SECRET_KEY and SPARKBOOST_API_KEY env vars or configure in plugin settings.");
      return;
    }

    const client = new SparkBoostClient({ secretKey, apiKey, baseUrl });
    const logger = (api as any).logger;
    let taskManager: SparkBoostTaskManager | null = null;

    logger?.info?.("sparkboost: plugin registered");

    // Register background task management service
    api.registerService({
      id: "sparkboost-task-manager",
      async start(ctx) {
        taskManager = new SparkBoostTaskManager(client, ctx.stateDir);
        await taskManager.start();
        ctx.logger.info?.("sparkboost: task manager service started");
      },
      async stop(ctx) {
        if (taskManager) {
          await taskManager.stop();
          taskManager = null;
        }
        ctx.logger.info?.("sparkboost: task manager service stopped");
      },
    });

    // --- Tool 1: List TikTok accounts ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "tiktok/auth/list"));
        }
      },
    }, { name: "sparkboost_list_accounts" });

    // --- Tool 2: List showcase products ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "tiktok/product/list"));
        }
      },
    }, { name: "sparkboost_list_products" });

    // --- Tool 3: Publish video ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "tiktok/video/publish"));
        }
      },
    }, { name: "sparkboost_publish" });

    // --- Tool 4: Check publish status ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "tiktok/video/status"));
        }
      },
    }, { name: "sparkboost_check_status" });

    // --- Tool 5: Submit Grok video task (async, returns immediately) ---
    api.registerTool({
      name: "sparkboost_grok_submit",
      label: "Submit Grok Video Task",
      description:
        "Submit an AI video generation task via Grok. Returns IMMEDIATELY with a task ID. " +
        "Video generation typically takes 5-8 minutes. " +
        "Use sparkboost_grok_task_status to check progress, or sparkboost_grok_wait to block until done.",
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
        if (!taskManager) {
          return errorResult("Task manager service not running — cannot submit async task");
        }
        try {
          const task = await taskManager.submit({
            prompt: params.prompt as string,
            duration: params.duration as number,
            aspectRatio: params.aspect_ratio as string,
            imageUrls: params.image_urls as string[] | undefined,
          });
          const summary = [
            `Video generation task submitted.`,
            `Task ID: ${task.taskId}`,
            `Status: ${task.status}`,
            `Prompt: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}"`,
            `Duration: ${task.duration}s | Aspect: ${task.aspectRatio}`,
            ``,
            `Video generation typically takes 5-8 minutes.`,
            `Use sparkboost_grok_task_status to check progress.`,
          ].join("\n");
          return textResult(
            wrapResponse(summary, "grokImagine/submit"),
            { taskId: task.taskId, status: task.status },
          );
        } catch (err: any) {
          return errorResult(wrapError(err.message, "grokImagine/submit"));
        }
      },
    }, { name: "sparkboost_grok_submit" });

    // --- Tool 6: Query Grok task status (from task manager) ---
    api.registerTool({
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
        if (!taskManager) {
          return errorResult("Task manager service not running");
        }
        const task = taskManager.getStatus(params.taskId as string);
        if (!task) {
          return errorResult(`Task not found: ${params.taskId}. Check the task ID from sparkboost_grok_submit.`);
        }
        const lines = [
          `Task ID: ${task.taskId}`,
          `Status: ${task.status}`,
          `Prompt: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}"`,
          `Poll count: ${task.pollCount}`,
          `Elapsed: ${Math.round((Date.now() - task.submittedAt) / 1000)}s`,
        ];
        if (task.status === "succeeded" && task.videoUrl) {
          lines.push(`Video URL: ${task.videoUrl}`);
        }
        if (task.status === "failed" && task.error) {
          lines.push(`Error: ${task.error}`);
        }
        return textResult(lines.join("\n"), {
          taskId: task.taskId,
          status: task.status,
          videoUrl: task.videoUrl,
        });
      },
    }, { name: "sparkboost_grok_task_status" });

    // --- Tool 7: List all Grok tasks ---
    api.registerTool({
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
        if (!taskManager) {
          return errorResult("Task manager service not running");
        }
        const tasks = taskManager.listTasks(params.status as VideoTask["status"] | undefined);
        if (tasks.length === 0) {
          return textResult("No video generation tasks found.");
        }
        const lines = tasks.map((t, i) => {
          const elapsed = Math.round((Date.now() - t.submittedAt) / 1000);
          const suffix = t.status === "succeeded" ? ` → ${t.videoUrl?.slice(0, 60)}...` : "";
          return `${i + 1}. [${t.status.toUpperCase()}] ${t.taskId} (${elapsed}s) "${t.prompt.slice(0, 40)}..."${suffix}`;
        });
        return textResult(
          `Video tasks (${tasks.length}):\n${lines.join("\n")}`,
          { count: tasks.length },
        );
      },
    }, { name: "sparkboost_grok_task_list" });

    // --- Tool 8: Wait for Grok task completion (blocking) ---
    api.registerTool({
      name: "sparkboost_grok_wait",
      label: "Wait for Grok Task",
      description:
        "Block until a video generation task completes (succeeded or failed). " +
        "Polls every 15 seconds. Use ONLY when you need to wait for a specific task. " +
        "For batch workflows, prefer sparkboost_grok_task_status to check progress without blocking.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ID from sparkboost_grok_submit" }),
        timeoutSeconds: Type.Optional(Type.Number({
          description: "Max wait time in seconds (default 600 = 10 min, max 1800 = 30 min)",
          minimum: 30,
          maximum: 1800,
          default: 600,
        })),
      }),
      async execute(_id, params): Promise<ToolResult> {
        if (!taskManager) {
          return errorResult("Task manager service not running");
        }
        const taskId = params.taskId as string;
        const timeoutMs = Math.min((params.timeoutSeconds as number || 600) * 1000, 1_800_000);
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          // First try the local task manager
          const task = taskManager.getStatus(taskId);
          if (!task) {
            return errorResult(`Task not found: ${taskId}`);
          }
          if (task.status === "succeeded") {
            return textResult(
              wrapResponse(
                `Video generation succeeded.\nTask ID: ${task.taskId}\nVideo URL: ${task.videoUrl}\nDuration: ${task.duration}s | Aspect: ${task.aspectRatio}`,
                "grokImagine/wait"
              ),
              { taskId: task.taskId, status: "succeeded", videoUrl: task.videoUrl },
            );
          }
          if (task.status === "failed") {
            return errorResult(wrapError(task.error || "Video generation failed", "grokImagine/wait"));
          }

          // Also poll the API directly for faster updates
          try {
            const raw = await client.get(`${GROK_RESULT}?id=${encodeURIComponent(taskId)}`);
            const json = JSON.parse(raw);
            const data = json.data || json;
            const apiStatus = data.status;

            if (apiStatus === 2 || apiStatus === "success") {
              const videoUrl = data.video_url || data.videoUrl || data.url;
              return textResult(
                wrapResponse(
                  `Video generation succeeded.\nTask ID: ${taskId}\nVideo URL: ${videoUrl}`,
                  "grokImagine/wait"
                ),
                { taskId, status: "succeeded", videoUrl },
              );
            }
            if (apiStatus === 3 || apiStatus === "failed") {
              return errorResult(wrapError(data.reason || data.message || "Video generation failed", "grokImagine/wait"));
            }
          } catch {
            // Poll error — fall through to sleep
          }

          await new Promise((r) => setTimeout(r, 15_000));
        }

        return errorResult(`Timed out waiting for task ${taskId} (${Math.round(timeoutMs / 1000)}s)`);
      },
    }, { name: "sparkboost_grok_wait" });

    // --- Tool 9: Cancel a Grok task ---
    api.registerTool({
      name: "sparkboost_grok_cancel",
      label: "Cancel Grok Task",
      description:
        "Cancel a pending or processing video generation task. " +
        "Completed tasks cannot be cancelled.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ID to cancel" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        if (!taskManager) {
          return errorResult("Task manager service not running");
        }
        const ok = taskManager.cancel(params.taskId as string);
        if (ok) {
          return textResult(`Task ${params.taskId} cancelled.`);
        }
        return errorResult(`Could not cancel task ${params.taskId} — not found or already completed.`);
      },
    }, { name: "sparkboost_grok_cancel" });

    // --- Tool 10: Composite snapshot ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "snapshot"));
        }
      },
    }, { name: "sparkboost_snapshot" });

    // --- Tool 11: Video compliance check ---
    api.registerTool({
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
        } catch (err: any) {
          return errorResult(wrapError(err.message, "video/compliance"));
        }
      },
    }, { name: "sparkboost_video_compliance" });
  },
});

type VideoTask = import("./task-manager").VideoTask;
