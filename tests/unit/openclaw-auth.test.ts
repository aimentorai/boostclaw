import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/BoostClaw-openclaw-auth-${suffix}`,
    testUserData: `/tmp/BoostClaw-openclaw-auth-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.boostclaw', 'openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.boostclaw', 'openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    join(testHome, '.boostclaw', 'openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'),
    'utf8'
  );
  return JSON.parse(content) as Record<string, unknown>;
}

async function writeAgentAuthProfiles(
  agentId: string,
  store: Record<string, unknown>
): Promise<void> {
  const agentDir = join(testHome, '.boostclaw', 'openclaw', 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify(store, null, 2), 'utf8');
}

describe('saveProviderKeyToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('only syncs auth profiles for configured agents', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.boostclaw/openclaw/workspace',
            agentDir: '~/.boostclaw/openclaw/agents/main/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.boostclaw/openclaw/workspace-test3',
            agentDir: '~/.boostclaw/openclaw/agents/test3/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.boostclaw', 'openclaw', 'agents', 'test2', 'agent'), {
      recursive: true,
    });
    await writeFile(
      join(testHome, '.boostclaw', 'openclaw', 'agents', 'test2', 'agent', 'auth-profiles.json'),
      JSON.stringify(
        {
          version: 1,
          profiles: {
            'legacy:default': {
              type: 'api_key',
              provider: 'legacy',
              key: 'legacy-key',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await saveProviderKeyToOpenClaw('openrouter', 'sk-test');

    const mainProfiles = await readAuthProfiles('main');
    const test3Profiles = await readAuthProfiles('test3');
    const staleProfiles = await readAuthProfiles('test2');

    expect(
      (mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key
    ).toBe('sk-test');
    expect(
      (test3Profiles.profiles as Record<string, { key: string }>)['openrouter:default'].key
    ).toBe('sk-test');
    expect(staleProfiles.profiles).toEqual({
      'legacy:default': {
        type: 'api_key',
        provider: 'legacy',
        key: 'legacy-key',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Saved API key for provider "openrouter" to OpenClaw auth-profiles (agents: main, test3)'
    );

    logSpy.mockRestore();
  });
});

describe('removeProviderKeyFromOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes only the default api-key profile for a provider', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:default': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-main',
        },
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': ['custom-abc12345:default', 'custom-abc12345:backup'],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('custom-abc12345', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'custom-abc12345:backup': {
        type: 'api_key',
        provider: 'custom-abc12345',
        key: 'sk-backup',
      },
    });
    expect(mainProfiles.order).toEqual({
      'custom-abc12345': ['custom-abc12345:backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });

  it('cleans stale default-profile references even when the profile object is already missing', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': ['custom-abc12345:default', 'custom-abc12345:backup'],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('custom-abc12345', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'custom-abc12345:backup': {
        type: 'api_key',
        provider: 'custom-abc12345',
        key: 'sk-backup',
      },
    });
    expect(mainProfiles.order).toEqual({
      'custom-abc12345': ['custom-abc12345:backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });

  it('does not remove oauth default profiles when deleting only an api key', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'openai-codex:default': {
          type: 'oauth',
          provider: 'openai-codex',
          access: 'acc',
          refresh: 'ref',
          expires: 1,
        },
      },
      order: {
        'openai-codex': ['openai-codex:default'],
      },
      lastGood: {
        'openai-codex': 'openai-codex:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('openai-codex', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'openai-codex:default': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'acc',
        refresh: 'ref',
        expires: 1,
      },
    });
    expect(mainProfiles.order).toEqual({
      'openai-codex': ['openai-codex:default'],
    });
    expect(mainProfiles.lastGood).toEqual({
      'openai-codex': 'openai-codex:default',
    });
  });

  it('removes api-key defaults for oauth-capable providers that support api keys', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'minimax-portal:default': {
          type: 'api_key',
          provider: 'minimax-portal',
          key: 'sk-minimax',
        },
        'minimax-portal:oauth-backup': {
          type: 'oauth',
          provider: 'minimax-portal',
          access: 'acc',
          refresh: 'ref',
          expires: 1,
        },
      },
      order: {
        'minimax-portal': ['minimax-portal:default', 'minimax-portal:oauth-backup'],
      },
      lastGood: {
        'minimax-portal': 'minimax-portal:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('minimax-portal', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'minimax-portal:oauth-backup': {
        type: 'oauth',
        provider: 'minimax-portal',
        access: 'acc',
        refresh: 'ref',
        expires: 1,
      },
    });
    expect(mainProfiles.order).toEqual({
      'minimax-portal': ['minimax-portal:oauth-backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });
});

describe('sanitizeOpenClawConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('skips sanitization when openclaw.json does not exist', async () => {
    // Ensure the .boostclaw/openclaw dir doesn't exist at all
    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Should not throw and should not create the file
    await expect(sanitizeOpenClawConfig()).resolves.toBeUndefined();

    const configPath = join(testHome, '.boostclaw', 'openclaw', 'openclaw.json');
    await expect(readFile(configPath, 'utf8')).rejects.toThrow();

    logSpy.mockRestore();
  });

  it('skips sanitization when openclaw.json contains invalid JSON', async () => {
    // Simulate a corrupted file: readJsonFile returns null, sanitize must bail out
    const openclawDir = join(testHome, '.boostclaw', 'openclaw');
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, 'openclaw.json');
    await writeFile(configPath, 'NOT VALID JSON {{{', 'utf8');
    const before = await readFile(configPath, 'utf8');

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const after = await readFile(configPath, 'utf8');
    // Corrupt file must not be overwritten
    expect(after).toBe(before);

    logSpy.mockRestore();
  });

  it('properly sanitizes a genuinely empty {} config (fresh install)', async () => {
    // A fresh install with {} is a valid config — sanitize should proceed
    // and enforce tools.profile, commands.restart, etc.
    await writeOpenClawJson({});

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const configPath = join(testHome, '.boostclaw', 'openclaw', 'openclaw.json');
    const result = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    // Fresh install should get tools settings enforced
    const tools = result.tools as Record<string, unknown>;
    expect(tools.profile).toBe('full');

    logSpy.mockRestore();
  });

  it('preserves user config (memory, agents, channels) when enforcing tools settings', async () => {
    await writeOpenClawJson({
      agents: { defaults: { model: { primary: 'openai/gpt-4' } } },
      channels: { discord: { token: 'tok', enabled: true } },
      memory: { enabled: true, limit: 100 },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const configPath = join(testHome, '.boostclaw', 'openclaw', 'openclaw.json');
    const result = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;

    // User-owned sections must survive the sanitize pass
    expect(result.memory).toEqual({ enabled: true, limit: 100 });
    expect(result.channels).toEqual({ discord: { token: 'tok', enabled: true } });
    expect((result.agents as Record<string, unknown>).defaults).toEqual({
      model: { primary: 'openai/gpt-4' },
    });
    // tools settings should now be enforced
    const tools = result.tools as Record<string, unknown>;
    expect(tools.profile).toBe('full');

    logSpy.mockRestore();
  });

  it('migrates legacy tools.web.search.kimi into moonshot plugin config', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          moonshot: { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'stale-inline-key',
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const tools = (result.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const moonshot = (
      (
        ((result.plugins as Record<string, unknown>).entries as Record<string, unknown>)
          .moonshot as Record<string, unknown>
      ).config as Record<string, unknown>
    ).webSearch as Record<string, unknown>;

    expect(search).not.toHaveProperty('kimi');
    expect(moonshot).not.toHaveProperty('apiKey');
    expect(moonshot.baseUrl).toBe('https://api.moonshot.cn/v1');
  });
});

describe('syncProviderConfigToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('writes moonshot web search config to plugin config instead of tools.web.search.kimi', async () => {
    await writeOpenClawJson({
      models: {
        providers: {},
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await syncProviderConfigToOpenClaw('moonshot', 'kimi-k2.5', {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
    });

    const result = await readOpenClawJson();
    const tools = (result.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const moonshot = (
      (
        ((result.plugins as Record<string, unknown>).entries as Record<string, unknown>)
          .moonshot as Record<string, unknown>
      ).config as Record<string, unknown>
    ).webSearch as Record<string, unknown>;

    expect(search).not.toHaveProperty('kimi');
    expect(moonshot.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('preserves legacy plugins array by converting it into plugins.load during moonshot sync', async () => {
    await writeOpenClawJson({
      plugins: ['/tmp/custom-plugin.js'],
      models: {
        providers: {},
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await syncProviderConfigToOpenClaw('moonshot', 'kimi-k2.5', {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
    });

    const result = await readOpenClawJson();
    const plugins = result.plugins as Record<string, unknown>;
    const load = plugins.load as string[];
    const moonshot = (
      ((plugins.entries as Record<string, unknown>).moonshot as Record<string, unknown>)
        .config as Record<string, unknown>
    ).webSearch as Record<string, unknown>;

    expect(load).toEqual(['/tmp/custom-plugin.js']);
    expect(moonshot.baseUrl).toBe('https://api.moonshot.cn/v1');
  });
});

describe('auth-backed provider discovery', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('detects active providers from openclaw auth profiles and per-agent auth stores', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.boostclaw/openclaw/workspace',
            agentDir: '~/.boostclaw/openclaw/agents/main/agent',
          },
          {
            id: 'work',
            name: 'Work',
            workspace: '~/.boostclaw/openclaw/workspace-work',
            agentDir: '~/.boostclaw/openclaw/agents/work/agent',
          },
        ],
      },
      auth: {
        profiles: {
          'openai-codex:default': {
            type: 'oauth',
            provider: 'openai-codex',
            access: 'acc',
            refresh: 'ref',
            expires: 1,
          },
          'anthropic:default': { type: 'api_key', provider: 'anthropic', key: 'sk-ant' },
        },
      },
    });

    await writeAgentAuthProfiles('work', {
      version: 1,
      profiles: {
        'google-gemini-cli:default': {
          type: 'oauth',
          provider: 'google-gemini-cli',
          access: 'goog-access',
          refresh: 'goog-refresh',
          expires: 2,
        },
      },
    });

    const { getActiveOpenClawProviders } = await import('@electron/utils/openclaw-auth');

    await expect(getActiveOpenClawProviders()).resolves.toEqual(
      new Set(['openai', 'anthropic', 'google'])
    );
  });

  it('seeds provider config entries from auth profiles when models.providers is empty', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.boostclaw/openclaw/workspace',
            agentDir: '~/.boostclaw/openclaw/agents/main/agent',
          },
          {
            id: 'work',
            name: 'Work',
            workspace: '~/.boostclaw/openclaw/workspace-work',
            agentDir: '~/.boostclaw/openclaw/agents/work/agent',
          },
        ],
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
        },
      },
      auth: {
        profiles: {
          'openai-codex:default': {
            type: 'oauth',
            provider: 'openai-codex',
            access: 'acc',
            refresh: 'ref',
            expires: 1,
          },
        },
      },
    });

    await writeAgentAuthProfiles('work', {
      version: 1,
      profiles: {
        'anthropic:default': {
          type: 'api_key',
          provider: 'anthropic',
          key: 'sk-ant',
        },
      },
    });

    const { getOpenClawProvidersConfig } = await import('@electron/utils/openclaw-auth');
    const result = await getOpenClawProvidersConfig();

    expect(result.defaultModel).toBe('openai/gpt-5.4');
    expect(result.providers).toMatchObject({
      openai: {},
      anthropic: {},
    });
  });

  it('removes all matching auth profiles for a deleted provider so it does not reappear', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.boostclaw/openclaw/workspace',
            agentDir: '~/.boostclaw/openclaw/agents/main/agent',
          },
          {
            id: 'work',
            name: 'Work',
            workspace: '~/.boostclaw/openclaw/workspace-work',
            agentDir: '~/.boostclaw/openclaw/agents/work/agent',
          },
        ],
      },
      models: {
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.moonshot.cn/v1',
            api: 'openai-completions',
          },
        },
      },
      auth: {
        profiles: {
          'custom-abc12345:oauth': {
            type: 'oauth',
            provider: 'custom-abc12345',
            access: 'acc',
            refresh: 'ref',
            expires: 1,
          },
          'custom-abc12345:secondary': {
            type: 'api_key',
            provider: 'custom-abc12345',
            key: 'sk-inline',
          },
        },
      },
    });

    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:default': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-main',
        },
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': ['custom-abc12345:default', 'custom-abc12345:backup'],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:backup',
      },
    });

    const { getActiveOpenClawProviders, getOpenClawProvidersConfig, removeProviderFromOpenClaw } =
      await import('@electron/utils/openclaw-auth');

    await expect(getActiveOpenClawProviders()).resolves.toEqual(new Set(['custom-abc12345']));

    await removeProviderFromOpenClaw('custom-abc12345');

    const mainProfiles = await readAuthProfiles('main');
    const config = await readOpenClawJson();
    const result = await getOpenClawProvidersConfig();

    expect(mainProfiles.profiles).toEqual({});
    expect(mainProfiles.order).toEqual({});
    expect(mainProfiles.lastGood).toEqual({});
    expect((config.auth as { profiles?: Record<string, unknown> }).profiles).toEqual({});
    expect((config.models as { providers?: Record<string, unknown> }).providers).toEqual({});
    expect(result.providers).toEqual({});
    await expect(getActiveOpenClawProviders()).resolves.toEqual(new Set());
  });
});

describe('syncPerformanceDefaultsToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  function getDefaults(config: Record<string, unknown>): Record<string, unknown> {
    const agents = config.agents as Record<string, unknown> | undefined;
    return (agents?.defaults ?? {}) as Record<string, unknown>;
  }

  it('injects model-agnostic defaults when no keys are set', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {},
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    const pruning = defaults.contextPruning as Record<string, unknown>;
    expect(pruning.mode).toBe('cache-ttl');
    expect(pruning.ttl).toBe('5m');
    expect(defaults.contextInjection).toBe('continuation-skip');

    const limits = defaults.contextLimits as Record<string, unknown>;
    expect(limits.toolResultMaxChars).toBe(16000);
    expect(defaults.bootstrapTotalMaxChars).toBe(60000);
  });

  it('sets cacheRetention=long and heartbeat for Anthropic provider', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'anthropic/claude-opus-4-6',
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    const params = defaults.params as Record<string, unknown>;
    expect(params.cacheRetention).toBe('long');

    const heartbeat = defaults.heartbeat as Record<string, unknown>;
    expect(heartbeat.every).toBe('55m');
  });

  it('sets cacheRetention=short for OpenAI provider without heartbeat', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'openai/gpt-5.4',
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    const params = defaults.params as Record<string, unknown>;
    expect(params.cacheRetention).toBe('short');
    expect(defaults.heartbeat).toBeUndefined();
  });

  it('sets cacheRetention=long for OpenRouter with Anthropic model', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'openrouter/anthropic/claude-sonnet-4-6',
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    const params = defaults.params as Record<string, unknown>;
    expect(params.cacheRetention).toBe('long');
  });

  it('handles model as object with primary', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: { primary: 'anthropic/claude-sonnet-4-6' },
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    const params = defaults.params as Record<string, unknown>;
    expect(params.cacheRetention).toBe('long');
  });

  it('does not override user-configured values', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'anthropic/claude-opus-4-6',
          contextInjection: 'always',
          contextPruning: { mode: 'off' },
          params: { cacheRetention: 'short' },
          heartbeat: { every: '30m' },
          contextLimits: { toolResultMaxChars: 8000 },
          bootstrapTotalMaxChars: 30000,
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    expect(defaults.contextInjection).toBe('always');

    const pruning = defaults.contextPruning as Record<string, unknown>;
    expect(pruning.mode).toBe('off');

    const params = defaults.params as Record<string, unknown>;
    expect(params.cacheRetention).toBe('short');

    const heartbeat = defaults.heartbeat as Record<string, unknown>;
    expect(heartbeat.every).toBe('30m');

    const limits = defaults.contextLimits as Record<string, unknown>;
    expect(limits.toolResultMaxChars).toBe(8000);
    expect(defaults.bootstrapTotalMaxChars).toBe(30000);
  });

  it('does not write when all keys are already configured', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'openai/gpt-5.4',
          contextInjection: 'continuation-skip',
          contextPruning: { mode: 'cache-ttl', ttl: '5m' },
          params: { cacheRetention: 'short' },
          contextLimits: { toolResultMaxChars: 16000 },
          bootstrapTotalMaxChars: 60000,
        },
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    expect(logSpy).not.toHaveBeenCalledWith('Synced performance defaults to openclaw.json');
    logSpy.mockRestore();
  });

  it('skips when agents.defaults is missing', async () => {
    await writeOpenClawJson({});

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    expect(logSpy).not.toHaveBeenCalledWith('Synced performance defaults to openclaw.json');
    logSpy.mockRestore();
  });

  it('skips cacheRetention for unknown providers', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: 'ollama/llama3.1:8b',
        },
      },
    });

    const { syncPerformanceDefaultsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncPerformanceDefaultsToOpenClaw();

    const config = await readOpenClawJson();
    const defaults = getDefaults(config);

    expect(defaults.params).toBeUndefined();
  });
});
