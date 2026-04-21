/**
 * SparkBoost OpenClaw Plugin
 *
 * Registers native Tools for TikTok video publishing and Grok video generation.
 * All API responses are wrapped with trust boundary markers.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { SparkBoostClient } from "./sparkboost-client";
import { wrapResponse, wrapError } from "./trust-boundary";

const TIKTOK_AUTH_LIST = "/api/v1/openapi/tiktok/auth/list";
const TIKTOK_PRODUCT_LIST = "/api/v1/openapi/tiktok/product/list";
const TIKTOK_VIDEO_PUBLISH = "/api/v1/openapi/tiktok/video/publish";
const TIKTOK_VIDEO_STATUS = "/api/v1/openapi/tiktok/video/status";
const GROK_SUBMIT = "/grokImagine/submit";
const GROK_RESULT = "/grokImagine/result";

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
    const cfg = (api as any).pluginConfig as { secretKey: string; apiKey: string; baseUrl?: string };
    const baseUrl = cfg.baseUrl || "http://gateway.microdata-inc.com";
    const client = new SparkBoostClient({ secretKey: cfg.secretKey, apiKey: cfg.apiKey, baseUrl });
    const logger = (api as any).logger;

    logger?.info?.("sparkboost: plugin registered");

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

    // --- Tool 5: Submit Grok video task ---
    api.registerTool({
      name: "sparkboost_grok_submit",
      label: "Submit Grok Video Task",
      description:
        "Submit an AI video generation task via Grok. Returns a task ID. " +
        "Use sparkboost_grok_result to poll for completion.",
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
        const body: Record<string, unknown> = {
          prompt: params.prompt,
          duration: params.duration,
          aspect_ratio: params.aspect_ratio,
        };
        const urls = params.image_urls as string[] | undefined;
        if (urls && urls.length > 0) {
          body.image_urls = params.image_urls;
        }
        try {
          const raw = await client.post(GROK_SUBMIT, body);
          return textResult(wrapResponse(raw, "grokImagine/submit"));
        } catch (err: any) {
          return errorResult(wrapError(err.message, "grokImagine/submit"));
        }
      },
    }, { name: "sparkboost_grok_submit" });

    // --- Tool 6: Query Grok video result ---
    api.registerTool({
      name: "sparkboost_grok_result",
      label: "Query Grok Video Result",
      description:
        "Check the result of a Grok video generation task. " +
        "Status: 0=init, 1=processing, 2=success (video_url available), 3=failed.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ID from sparkboost_grok_submit response" }),
      }),
      async execute(_id, params): Promise<ToolResult> {
        try {
          const raw = await client.get(`${GROK_RESULT}?id=${encodeURIComponent(String(params.taskId))}`);
          return textResult(wrapResponse(raw, "grokImagine/result"));
        } catch (err: any) {
          return errorResult(wrapError(err.message, "grokImagine/result"));
        }
      },
    }, { name: "sparkboost_grok_result" });

    // --- Tool 7: Composite snapshot ---
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
  },
});
