import type { TemplateConfig } from '@/types/template';

type Translate = (key: string, options?: Record<string, unknown>) => unknown;

export function getTemplateName(t: Translate, template: TemplateConfig): string {
  const value = t(`templates.${template.id}.name`, { defaultValue: template.name });
  return typeof value === 'string' ? value : template.name;
}

export function getTemplateDescription(t: Translate, template: TemplateConfig): string {
  const value = t(`templates.${template.id}.description`, {
    defaultValue: template.description,
  });
  return typeof value === 'string' ? value : template.description;
}

export function getTemplateWelcomeMessage(t: Translate, template: TemplateConfig): string {
  const value = t(`templates.${template.id}.welcomeMessage`, {
    defaultValue: template.welcomeMessage,
  });
  return typeof value === 'string' ? value : template.welcomeMessage;
}

export function getTemplateSuggestedPrompts(
  t: Translate,
  template: TemplateConfig
): string[] {
  const value = t(`templates.${template.id}.suggestedPrompts`, {
    returnObjects: true,
    defaultValue: template.suggestedPrompts,
  });
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : template.suggestedPrompts;
}
