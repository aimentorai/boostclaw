/**
 * Conversation Template Type Definitions
 * Templates share an agent but provide different UX entry points with their own
 * welcomeMessage, suggestedPrompts, and requiredSkills.
 */

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  welcomeMessage: string;
  suggestedPrompts: string[];
  requiredSkills: string[];
  enabled: boolean;
}

export interface TemplateManifest {
  templates: TemplateConfig[];
}

export interface TemplateSkillStatus {
  skillId: string;
  installed: boolean;
  enabled: boolean;
}
