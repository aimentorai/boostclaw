/**
 * Trust boundary wrapper for SparkBoost API responses.
 *
 * All external API responses are wrapped with markers so the LLM orchestrator
 * can distinguish trusted internal data from untrusted third-party content.
 * Prevents indirect prompt injection via API response fields (product titles,
 * error messages, etc.).
 */

const BEGIN_MARKER = "--- BEGIN SPARKBOOST API RESPONSE ---";
const END_MARKER = "--- END SPARKBOOST API RESPONSE ---";

const ESCAPED_BEGIN = "--- BEGIN SPARKBOOST API RESP\u200BONSE ---";
const ESCAPED_END = "--- END SPARKBOOST API RESP\u200BONSE ---";

export function wrapResponse(body: string, endpoint: string): string {
  const safeBody = body
    .replaceAll(BEGIN_MARKER, ESCAPED_BEGIN)
    .replaceAll(END_MARKER, ESCAPED_END);
  return `${BEGIN_MARKER} (${endpoint})\n${safeBody}\n${END_MARKER}`;
}

export function wrapError(message: string, endpoint: string): string {
  return `${BEGIN_MARKER} (${endpoint}) [ERROR]\n${message}\n${END_MARKER}`;
}
