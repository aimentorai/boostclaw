import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-auth-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-auth-user-data-${suffix}`,
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
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function writeAgentModelsJson(agentId: string, data: unknown | string): Promise<void> {
  const modelsDir = join(testHome, '.openclaw', 'agents', agentId, 'agent');
  await mkdir(modelsDir, { recursive: true });
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await writeFile(join(modelsDir, 'models.json'), content, 'utf8');
}

async function readAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
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
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'agents', 'test2', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'legacy:default': {
            type: 'api_key',
            provider: 'legacy',
            key: 'legacy-key',
          },
        },
      }, null, 2),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await saveProviderKeyToOpenClaw('openrouter', 'sk-test');

    const mainProfiles = await readAuthProfiles('main');
    const test3Profiles = await readAuthProfiles('test3');
    const staleProfiles = await readAuthProfiles('test2');

    expect((mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect((test3Profiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect(staleProfiles.profiles).toEqual({
      'legacy:default': {
        type: 'api_key',
        provider: 'legacy',
        key: 'legacy-key',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Saved API key for provider "openrouter" to OpenClaw auth-profiles (agents: main, test3)',
    );

    logSpy.mockRestore();
  });
});

describe('reconcileOpenClawProviderModelsFromAgentModelsJson', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lifts rich model metadata from models.json into openclaw.json', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'custom-custom06': {
            baseUrl: 'https://api.siliconflow.cn/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'Pro/moonshotai/Kimi-K2.5',
                name: 'Pro/moonshotai/Kimi-K2.5',
              },
            ],
          },
        },
      },
    });

    await writeAgentModelsJson('main', {
      providers: {
        'custom-custom06': {
          models: [
            {
              id: 'Pro/moonshotai/Kimi-K2.5',
              name: 'Pro/moonshotai/Kimi-K2.5',
              input: ['text', 'image'],
              reasoning: true,
              contextWindow: 200000,
              maxTokens: 8192,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          ],
        },
      },
    });

    const { reconcileOpenClawProviderModelsFromAgentModelsJson } = await import('@electron/utils/openclaw-auth');
    await reconcileOpenClawProviderModelsFromAgentModelsJson();

    const openclaw = await readOpenClawJson();
    const providers = ((openclaw.models as Record<string, unknown>)?.providers ?? {}) as Record<string, unknown>;
    const provider = providers['custom-custom06'] as Record<string, unknown>;
    const models = provider.models as Array<Record<string, unknown>>;
    const model = models[0];

    expect(model.input).toEqual(['text', 'image']);
    expect(model.reasoning).toBe(true);
    expect(model.contextWindow).toBe(200000);
    expect(model.maxTokens).toBe(8192);
    expect(model.cost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('preserves existing rich metadata during provider sync updates', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'custom-custom06': {
            baseUrl: 'https://api.siliconflow.cn/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'Pro/moonshotai/Kimi-K2.5',
                name: 'Pro/moonshotai/Kimi-K2.5',
                input: ['text', 'image'],
                contextWindow: 200000,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('custom-custom06', 'Pro/moonshotai/Kimi-K2.5', {
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
    });

    const openclaw = await readOpenClawJson();
    const providers = ((openclaw.models as Record<string, unknown>)?.providers ?? {}) as Record<string, unknown>;
    const provider = providers['custom-custom06'] as Record<string, unknown>;
    const models = provider.models as Array<Record<string, unknown>>;
    const model = models.find((entry) => entry.id === 'Pro/moonshotai/Kimi-K2.5');

    expect(model?.input).toEqual(['text', 'image']);
    expect(model?.contextWindow).toBe(200000);
    expect(model?.maxTokens).toBe(8192);
  });

  it('no-ops when providers or model IDs do not match', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'custom-custom06': {
            baseUrl: 'https://api.siliconflow.cn/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'Pro/moonshotai/Kimi-K2.5',
                name: 'Pro/moonshotai/Kimi-K2.5',
                input: ['text'],
              },
            ],
          },
        },
      },
    });

    await writeAgentModelsJson('main', {
      providers: {
        'custom-other': {
          models: [
            {
              id: 'another-model',
              input: ['text', 'image'],
            },
          ],
        },
      },
    });

    const { reconcileOpenClawProviderModelsFromAgentModelsJson } = await import('@electron/utils/openclaw-auth');
    await reconcileOpenClawProviderModelsFromAgentModelsJson();

    const openclaw = await readOpenClawJson();
    const providers = ((openclaw.models as Record<string, unknown>)?.providers ?? {}) as Record<string, unknown>;
    const model = ((providers['custom-custom06'] as Record<string, unknown>).models as Array<Record<string, unknown>>)[0];
    expect(model.input).toEqual(['text']);
  });

  it('handles malformed models.json gracefully', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'custom-custom06': {
            baseUrl: 'https://api.siliconflow.cn/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'Pro/moonshotai/Kimi-K2.5',
                name: 'Pro/moonshotai/Kimi-K2.5',
                input: ['text'],
              },
            ],
          },
        },
      },
    });

    await writeAgentModelsJson('main', '{ not-json ');
    const { reconcileOpenClawProviderModelsFromAgentModelsJson } = await import('@electron/utils/openclaw-auth');

    await expect(reconcileOpenClawProviderModelsFromAgentModelsJson()).resolves.toBeUndefined();

    const openclaw = await readOpenClawJson();
    const providers = ((openclaw.models as Record<string, unknown>)?.providers ?? {}) as Record<string, unknown>;
    const model = ((providers['custom-custom06'] as Record<string, unknown>).models as Array<Record<string, unknown>>)[0];
    expect(model.input).toEqual(['text']);
  });
});
