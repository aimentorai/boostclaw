/**
 * Templates State Store
 * Manages conversation templates — UI entry points that share an agent
 * but provide different welcomeMessage, suggestedPrompts, and skills.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useSkillsStore } from './skills';
import type { TemplateConfig, TemplateManifest, TemplateSkillStatus } from '../types/template';

interface TemplatesState {
  templates: TemplateConfig[];
  skillStatuses: Record<string, TemplateSkillStatus[]>;
  activeTemplate: TemplateConfig | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  loadTemplates: () => Promise<void>;
  syncSkillStatuses: () => void;
  setActiveTemplate: (template: TemplateConfig | null) => void;
}

export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: [],
  skillStatuses: {},
  activeTemplate: null,
  initialized: false,
  loading: false,
  error: null,

  loadTemplates: async () => {
    if (get().initialized) return;
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<TemplateManifest>('/api/templates/manifest');
      const templates = Array.isArray(result.templates)
        ? result.templates.filter((t) => t.enabled)
        : [];
      set({ templates, initialized: true, loading: false });
      get().syncSkillStatuses();
    } catch (err) {
      console.warn('Failed to load template manifest:', err);
      set({ loading: false, error: String(err), initialized: true });
    }
  },

  syncSkillStatuses: () => {
    const { templates } = get();
    const skills = useSkillsStore.getState().skills;

    const statuses: Record<string, TemplateSkillStatus[]> = {};
    for (const template of templates) {
      statuses[template.id] = template.requiredSkills.map((skillId) => {
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

  setActiveTemplate: (template) => {
    set({ activeTemplate: template });
  },
}));

// Auto-sync when skills change
useSkillsStore.subscribe((state, prevState) => {
  if (state.skills !== prevState.skills && useTemplatesStore.getState().initialized) {
    useTemplatesStore.getState().syncSkillStatuses();
  }
});
