/**
 * Local type declarations for OpenClaw Plugin SDK.
 *
 * These are runtime-provided types. Declared locally so the plugin
 * compiles without installing the full openclaw package as a devDependency.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  import { TSchema } from "@sinclair/typebox";

  interface ToolDefinition {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute(toolCallId: string, params: Record<string, unknown>): Promise<ToolResult>;
  }

  interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
  }

  interface PluginApi {
    pluginConfig: Record<string, unknown>;
    logger: { info?(msg: string): void; warn?(msg: string): void; error?(msg: string): void };
    resolvePath(p: string): string;
    registerTool(tool: ToolDefinition, options?: { name: string }): void;
    registerHook(event: string, handler: (...args: any[]) => any): void;
  }

  interface PluginEntry {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema: TSchema;
    register(api: PluginApi): void;
  }

  export function definePluginEntry(def: {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema: TSchema;
    register(api: PluginApi): void;
  }): PluginEntry;
}
