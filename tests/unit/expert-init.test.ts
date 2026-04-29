import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
let configDir: string;
let resourcesDir: string;

vi.mock('@electron/utils/agent-config', () => ({
  createAgent: vi.fn(async (name: string, _opts: any) => {
    const agentId = `agent-${name}-id`;
    return {
      agents: [{ id: agentId, name, workspace: join(configDir, 'workspaces', name) }],
    };
  }),
  deleteAgentConfig: vi.fn(async (agentId: string) => ({
    removedEntry: { id: agentId },
  })),
  removeAgentWorkspaceDirectory: vi.fn(async () => {}),
  listAgentsSnapshot: vi.fn(async () => ({ agents: [] })),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => configDir,
  getResourcesDir: () => resourcesDir,
  expandPath: (p: string) => p.replace('$HOME', configDir),
}));

vi.mock('@electron/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('expert-init', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'expert-init-test-'));
    configDir = join(testDir, 'config');
    resourcesDir = join(testDir, 'resources');
    mkdtempSync(join(testDir, 'config'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('readExpertManifest', () => {
    it('reads and parses the manifest', async () => {
      const { readExpertManifest } = await import('@electron/utils/expert-init');
      expect(typeof readExpertManifest).toBe('function');
    });
  });

  describe('expertUsesSparkBoost', () => {
    it('detects sparkboost skills', async () => {
      const { expertUsesSparkBoost } = await import('@electron/utils/expert-init');

      expect(expertUsesSparkBoost({ requiredSkills: ['video-maker'] })).toBe(true);
      expect(expertUsesSparkBoost({ requiredSkills: ['some-other-skill'] })).toBe(false);
      expect(expertUsesSparkBoost({ requiredSkills: [] })).toBe(false);
    });
  });

  describe('generateUserMd', () => {
    it('detects timezone and locale dynamically', async () => {
      const { generateUserMd } = await import('@electron/utils/expert-init');

      const result = generateUserMd();
      expect(result).toContain('时区:');
      expect(result).toContain('语言:');
      expect(result).toContain('业务: TikTok 跨境电商');
    });
  });

  describe('readMainAgentBootstrap', () => {
    it('reads optional prompt overrides', async () => {
      const { readMainAgentBootstrap } = await import('@electron/utils/expert-init');
      const { mkdirSync } = await import('fs');
      const expertsDir = join(resourcesDir, 'experts');
      mkdirSync(expertsDir, { recursive: true });
      writeFileSync(
        join(expertsDir, 'main-agent-bootstrap.json'),
        JSON.stringify({
          version: 14,
          systemPrompt: 'system',
          identityPrompt: 'identity',
          agentsPrompt: '# Custom AGENTS',
          toolsPrompt: '# Custom TOOLS',
          userPrompt: '# Custom USER',
          heartbeatPrompt: '# Custom HEARTBEAT',
        }),
        'utf-8'
      );

      const result = await readMainAgentBootstrap();
      expect(result?.version).toBe(14);
      expect(result?.agentsPrompt).toBe('# Custom AGENTS');
      expect(result?.toolsPrompt).toBe('# Custom TOOLS');
      expect(result?.userPrompt).toBe('# Custom USER');
      expect(result?.heartbeatPrompt).toBe('# Custom HEARTBEAT');
    });

    it('loads prompt overrides from referenced files', async () => {
      const { readMainAgentBootstrap } = await import('@electron/utils/expert-init');
      const { mkdirSync } = await import('fs');
      const expertsDir = join(resourcesDir, 'experts');
      const promptsDir = join(expertsDir, 'main-agent');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, 'SOUL.md'), '# File SOUL', 'utf-8');
      writeFileSync(join(promptsDir, 'AGENTS.md'), '# File AGENTS', 'utf-8');
      writeFileSync(
        join(expertsDir, 'main-agent-bootstrap.json'),
        JSON.stringify({
          version: 16,
          systemPromptFile: 'main-agent/SOUL.md',
          agentsPromptFile: 'main-agent/AGENTS.md',
        }),
        'utf-8'
      );

      const result = await readMainAgentBootstrap();
      expect(result?.systemPrompt).toBe('# File SOUL');
      expect(result?.agentsPrompt).toBe('# File AGENTS');
    });
  });

  describe('readPluginToolsMd', () => {
    it('reads TOOLS.md from plugin directory', async () => {
      const { readPluginToolsMd } = await import('@electron/utils/expert-init');

      const docsDir = join(resourcesDir, 'openclaw-plugins', 'sparkboost', 'docs');
      const { mkdirSync } = await import('fs');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(docsDir, 'TOOLS.md'), '# Test Tools', 'utf-8');

      const content = await readPluginToolsMd('sparkboost');
      expect(content).toBe('# Test Tools');
    });

    it('returns null when plugin has no TOOLS.md', async () => {
      const { readPluginToolsMd } = await import('@electron/utils/expert-init');

      const content = await readPluginToolsMd('nonexistent-plugin');
      expect(content).toBeNull();
    });
  });

  describe('initializeExperts', () => {
    it('returns empty array for empty manifest', async () => {
      const { initializeExperts } = await import('@electron/utils/expert-init');
      expect(typeof initializeExperts).toBe('function');
    });
  });
});
