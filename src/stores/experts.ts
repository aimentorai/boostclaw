/**
 * Experts State Store
 * Manages pre-installed expert configuration and runtime status
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useAgentsStore } from './agents';
import { useSkillsStore } from './skills';
import type { ExpertConfig, ExpertManifest, ExpertRuntime } from '../types/expert';

/** Per-skill availability status for an expert */
export interface ExpertSkillStatus {
  skillId: string;
  installed: boolean;
  enabled: boolean;
}

interface ExpertsState {
  /** Loaded expert configs from manifest */
  experts: ExpertConfig[];
  /** Runtime status for each expert (keyed by expert id) */
  runtimes: Record<string, ExpertRuntime>;
  /** Per-expert skill availability (keyed by expert id) */
  skillStatuses: Record<string, ExpertSkillStatus[]>;
  /** Whether the store has been initialized */
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Actions
  loadExperts: () => Promise<void>;
  syncWithAgents: () => void;
  syncSkillStatuses: () => void;
  setRuntime: (expertId: string, runtime: Partial<ExpertRuntime>) => void;
  getExpertByAgentId: (agentId: string) => ExpertRuntime | undefined;
  getExpertById: (expertId: string) => ExpertRuntime | undefined;
  isExpertSession: (sessionKey: string) => boolean;
}

export const useExpertsStore = create<ExpertsState>((set, get) => ({
  experts: [],
  runtimes: {},
  skillStatuses: {},
  initialized: false,
  loading: false,
  error: null,

  loadExperts: async () => {
    if (get().initialized) return;
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<ExpertManifest>('/api/experts/manifest');
      const experts = Array.isArray(result.experts) ? result.experts : [];
      const runtimes: Record<string, ExpertRuntime> = {};
      for (const config of experts) {
        if (config.enabled) {
          runtimes[config.id] = { config, status: 'setting-up' };
        }
      }
      set({ experts, runtimes, initialized: true, loading: false });

      // Cross-reference with agents store to resolve actual status
      get().syncWithAgents();
      get().syncSkillStatuses();
    } catch (err) {
      console.warn('Failed to load expert manifest:', err);
      set({ loading: false, error: String(err), initialized: true });
    }
  },

  /**
   * Sync runtime status by matching expert IDs against loaded agents.
   * Agents tagged with `expertId` indicate the backend initialization succeeded.
   */
  syncWithAgents: () => {
    const { runtimes } = get();
    const agents = useAgentsStore.getState().agents;

    const updated = { ...runtimes };
    for (const agent of agents) {
      if (!agent.expertId) continue;
      const runtime = updated[agent.expertId];
      if (!runtime) continue;

      const failedSkills = runtime.failedSkills ?? [];
      updated[agent.expertId] = {
        ...runtime,
        agentId: agent.id,
        mainSessionKey: agent.mainSessionKey ?? `agent:${agent.id}:main`,
        status: failedSkills.length > 0 ? 'limited' : 'ready',
      };
    }

    // Mark experts with no matching agent and no error as 'unavailable'
    for (const [expertId, runtime] of Object.entries(updated)) {
      if (!runtime.agentId && runtime.status === 'setting-up') {
        const hasAgent = agents.some((a) => a.expertId === expertId);
        if (agents.length > 0 && !hasAgent) {
          updated[expertId] = {
            ...runtime,
            status: 'unavailable',
            errorMessage: 'Backend initialization did not create agent for this expert.',
          };
        }
      }
    }

    set({ runtimes: updated });
  },

  /**
   * Cross-reference each expert's requiredSkills with the skills store
   * to determine which are installed/enabled and which are missing.
   */
  syncSkillStatuses: () => {
    const { runtimes } = get();
    const skills = useSkillsStore.getState().skills;

    const statuses: Record<string, ExpertSkillStatus[]> = {};
    for (const [expertId, runtime] of Object.entries(runtimes)) {
      statuses[expertId] = runtime.config.requiredSkills.map((skillId) => {
        const found = skills.find(
          (s) => s.id === skillId || s.slug === skillId || s.name === skillId
        );
        return {
          skillId,
          installed: !!found,
          enabled: found?.enabled ?? false,
        };
      });
    }
    set({ skillStatuses: statuses });
  },

  setRuntime: (expertId, runtime) => {
    set((state) => {
      const existing = state.runtimes[expertId];
      if (!existing) return state;
      return {
        runtimes: {
          ...state.runtimes,
          [expertId]: { ...existing, ...runtime },
        },
      };
    });
  },

  getExpertByAgentId: (agentId) => {
    const { runtimes } = get();
    return Object.values(runtimes).find((r) => r.agentId === agentId);
  },

  getExpertById: (expertId) => {
    const { runtimes } = get();
    return runtimes[expertId];
  },

  isExpertSession: (sessionKey) => {
    const { runtimes } = get();
    const agentPart = sessionKey.startsWith('agent:') ? sessionKey.split(':')[1] : null;
    if (!agentPart) return false;
    return Object.values(runtimes).some((r) => r.agentId === agentPart);
  },
}));

// Auto-sync when agents change (e.g., after agents store loads)
useAgentsStore.subscribe((state, prevState) => {
  if (state.agents !== prevState.agents && useExpertsStore.getState().initialized) {
    useExpertsStore.getState().syncWithAgents();
  }
});

// Auto-sync when skills change (install/enable/disable)
useSkillsStore.subscribe((state, prevState) => {
  if (state.skills !== prevState.skills && useExpertsStore.getState().initialized) {
    useExpertsStore.getState().syncSkillStatuses();
  }
});
