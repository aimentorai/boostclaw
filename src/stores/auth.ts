import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';

type AuthProfile = {
  email?: string;
  subject?: string;
  scope?: string;
  expiresAt?: number;
};

type AuthStatusResponse = {
  enabled: boolean;
  authenticated: boolean;
  profile?: AuthProfile;
};

const AUTH_STATUS_MAX_RETRIES = 6;
const AUTH_STATUS_RETRY_DELAY_MS = 500;
let authStatusRetryAttempts = 0;

function isTransientAuthStatusError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return (
    text.includes('hostapi:fetch')
    || text.includes('no handler registered')
    || text.includes('invalid ipc channel')
    || text.includes('channel_unavailable')
    || text.includes('econnrefused')
    || text.includes('failed to fetch')
    || text.includes('unauthorized')
  );
}

interface AuthState {
  enabled: boolean;
  authenticated: boolean;
  profile: AuthProfile | null;
  loading: boolean;
  pendingLogin: boolean;
  error: string | null;
  init: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  enabled: true,
  authenticated: true,
  profile: null,
  loading: true,
  pendingLogin: false,
  error: null,

  init: async () => {
    await useAuthStore.getState().refreshStatus();
  },

  refreshStatus: async () => {
    set({ loading: true });
    try {
      const status = await hostApiFetch<AuthStatusResponse>('/api/auth/status');
      authStatusRetryAttempts = 0;
      set({
        enabled: status.enabled,
        authenticated: status.authenticated,
        profile: status.profile ?? null,
        loading: false,
        pendingLogin: false,
        error: null,
      });
    } catch (error) {
      const transient = isTransientAuthStatusError(error);
      if (transient && authStatusRetryAttempts < AUTH_STATUS_MAX_RETRIES) {
        authStatusRetryAttempts += 1;
        set({ pendingLogin: false, error: String(error), loading: true });
        setTimeout(() => {
          void useAuthStore.getState().refreshStatus();
        }, AUTH_STATUS_RETRY_DELAY_MS);
        return;
      }

      authStatusRetryAttempts = 0;
      set((state) => ({
        enabled: state.enabled,
        authenticated: state.authenticated,
        profile: state.profile,
        loading: false,
        pendingLogin: false,
        error: String(error),
      }));
    }
  },

  login: async () => {
    set({ pendingLogin: true, error: null });
    try {
      await hostApiFetch<{ success: boolean; error?: string }>('/api/auth/login', { method: 'POST' });
    } catch (error) {
      set({
        pendingLogin: false,
        error: String(error),
      });
      return;
    }
  },

  logout: async () => {
    try {
      await hostApiFetch<{ success: boolean; error?: string }>('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      set({ error: String(error) });
    }
    set({
      pendingLogin: false,
      authenticated: false,
      profile: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
