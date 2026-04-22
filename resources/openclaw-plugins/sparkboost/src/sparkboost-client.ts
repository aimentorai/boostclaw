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

export class SparkBoostClient {
  private readonly secretKey: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SparkBoostConfig) {
    this.secretKey = config.secretKey;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
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
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

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
    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SparkBoostError(res.status, path, text);
    }

    return text;
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
