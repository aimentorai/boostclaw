/**
 * Expert Type Definitions
 * Types for the pre-installed expert system
 */

/**
 * Expert configuration — defines a pre-installed domain expert.
 * Each expert maps to an underlying Agent with curated personality, skills, and guidance.
 */
export interface ExpertConfig {
  /** Unique identifier (e.g., "cross-border-video-expert") */
  id: string;
  /** Display name (e.g., "跨境电商视频专家") */
  name: string;
  /** One-line description */
  description: string;
  /** Icon identifier or emoji */
  icon: string;
  /** Category for grouping (e.g., "marketing", "content") */
  category: string;
  /** SOUL.md content for the underlying Agent */
  systemPrompt: string;
  /** IDENTITY.md content */
  identityPrompt: string;
  /** First message shown when entering expert chat */
  welcomeMessage: string;
  /** 3-4 suggested user prompts */
  suggestedPrompts: string[];
  /** Skill IDs to ensure installed & enabled globally */
  requiredSkills: string[];
  /** Optional model override */
  defaultModel?: string;
  /** Short tips shown on the expert detail view */
  usageTips: string[];
  /** Whether this expert is visible to users (set by app, not user) */
  enabled: boolean;
}

/**
 * Runtime status for an expert — tracks initialization state.
 */
export type ExpertStatus = 'ready' | 'setting-up' | 'limited' | 'unavailable';

/**
 * Runtime expert data — combines config with initialization status and agent mapping.
 */
export interface ExpertRuntime {
  config: ExpertConfig;
  status: ExpertStatus;
  /** ID of the underlying Agent (set after initialization) */
  agentId?: string;
  /** Main session key for the underlying agent */
  mainSessionKey?: string;
  /** Skills that failed to install */
  failedSkills?: string[];
  /** Error message if status is 'unavailable' */
  errorMessage?: string;
}

/**
 * Manifest file structure — mirrors the skills manifest pattern.
 */
export interface ExpertManifest {
  experts: ExpertConfig[];
}
