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
  enabled: false,
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
      set({
        enabled: status.enabled,
        authenticated: status.authenticated,
        profile: status.profile ?? null,
        loading: false,
      });
    } catch (error) {
      set({
        enabled: false,
        authenticated: true,
        profile: null,
        loading: false,
        error: String(error),
      });
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
