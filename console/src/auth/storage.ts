import type { AuthState } from "./types";

declare const TOKEN: string;

const AUTH_STORAGE_KEY = "boostclaw.console.auth";

function getPyWebViewApi() {
  return typeof window !== "undefined" ? window.pywebview?.api : undefined;
}

function getEnvToken(): string {
  return TOKEN;
}

export function loadAuthState(): AuthState {
  if (typeof window === "undefined") {
    return { token: getEnvToken(), user: null };
  }

  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthState>;
      if (typeof parsed.token === "string") {
        return {
          token: parsed.token,
          user: parsed.user ?? null,
        };
      }
    }
  } catch {
    // Ignore malformed storage and fallback to env token.
  }

  return { token: getEnvToken(), user: null };
}

export function saveAuthState(state: AuthState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));

  // Also persist to disk via pywebview for desktop app survival across restarts.
  const api = getPyWebViewApi();
  if (api) {
    void api.set_auth_state(JSON.stringify(state)).catch(() => undefined);
  }
}

export function clearAuthState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);

  // Also clear persisted auth on disk.
  const api = getPyWebViewApi();
  if (api) {
    void api.clear_auth_state().catch(() => undefined);
  }
}

export function getStoredAuthToken(): string {
  if (typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    return typeof parsed.token === "string" ? parsed.token : "";
  } catch {
    return "";
  }
}

/**
 * Attempt to hydrate auth state from the desktop app's disk-persisted file.
 * Returns the AuthState if found and valid, or null otherwise.
 * This is only available when running inside pywebview (desktop app).
 */
export async function hydrateAuthStateFromDesktop(): Promise<AuthState | null> {
  const api = getPyWebViewApi();
  if (!api) return null;

  try {
    const raw = await api.get_auth_state();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (typeof parsed.token === "string" && parsed.token) {
      return {
        token: parsed.token,
        user: parsed.user ?? null,
      };
    }
  } catch {
    // Ignore errors — desktop hydration is best-effort.
  }

  return null;
}
