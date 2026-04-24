/**
 * HTTP client for SparkBoost API.
 *
 * Handles authentication via secret-key header, error normalization,
 * and response parsing. All responses are returned as raw strings
 * for the trust boundary layer to wrap.
 */

export interface SparkBoostConfig {
  secretKey: string;
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class SparkBoostClient {
  private readonly secretKey: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: SparkBoostConfig & { timeoutMs?: number }) {
    this.secretKey = config.secretKey;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async post(path: string, body?: Record<string, unknown>): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "secret-key": this.secretKey,
    };
    if (path.startsWith("/api/")) {
      headers["X-Api-Key"] = this.apiKey;
    }
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      },
      this.timeoutMs,
    );

    const text = await res.text();
    if (!res.ok) {
      throw new SparkBoostError(res.status, path, text);
    }

    const json = JSON.parse(text);
    if (!json.success && json.code !== 200) {
      throw new SparkBoostError(res.status, path, json.msg || text);
    }

    return text;
  }

  async get(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "secret-key": this.secretKey,
    };
    if (path.startsWith("/api/")) {
      headers["X-Api-Key"] = this.apiKey;
    }

    let lastError: Error = new Error(`GET ${path} failed after retries`);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          url,
          { method: "GET", headers },
          this.timeoutMs,
        );

        const text = await res.text();
        if (!res.ok) {
          if (attempt < RETRY_DELAYS_MS.length && isRetryable(res.status)) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
            continue;
          }
          throw new SparkBoostError(res.status, path, text);
        }

        return text;
      } catch (err) {
        if (err instanceof SparkBoostError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    throw lastError;
  }
}

export class SparkBoostError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: string,
  ) {
    super(`SparkBoost API error (${status}) on ${endpoint}: ${body.slice(0, 200)}`);
    this.name = "SparkBoostError";
  }
}
