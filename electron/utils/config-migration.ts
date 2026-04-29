import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir, getLegacyOpenClawConfigDir, ensureDir } from './paths';
import * as logger from './logger';
import { PROVIDER_DEFINITIONS } from '../shared/providers/registry';

const MIGRATION_MARKER_FILE = '.boostclaw-migration-complete';
const AUTH_MIGRATION_MARKER_FILE = '.boostclaw-auth-migration-complete';

/**
 * Normalize a model ref string like "deepseek/qwen-plus".
 * If the model ID belongs to a different provider, rewrite the ref to point
 * to the correct provider. Returns the original ref when no correction is needed.
 */
function normalizeModelRefString(ref: string): string {
  const slashIndex = ref.indexOf('/');
  if (slashIndex <= 0) return ref;

  const providerKey = ref.slice(0, slashIndex);
  const modelId = ref.slice(slashIndex + 1);

  const definition = PROVIDER_DEFINITIONS.find((d) => d.id === providerKey);
  if (!definition?.defaultModelId) return ref;

  if (modelId === definition.defaultModelId) return ref;

  // The model doesn't match this provider — find the correct one
  const correctProvider = PROVIDER_DEFINITIONS.find((d) => d.defaultModelId === modelId);
  if (correctProvider) {
    logger.warn(
      `[config-migration] Correcting model ref: "${ref}" → "${correctProvider.id}/${modelId}" ` +
        `(model "${modelId}" belongs to "${correctProvider.id}", not "${providerKey}")`
    );
    return `${correctProvider.id}/${modelId}`;
  }

  return ref;
}

/**
 * Sanitize a model ref (string or { primary: string }) during migration.
 * Corrects provider/model mismatches in the ref.
 */
function sanitizeModelRef(model: unknown): unknown {
  if (model && typeof model === 'object') {
    const obj = model as Record<string, unknown>;
    if (typeof obj.primary === 'string') {
      return { ...obj, primary: normalizeModelRefString(obj.primary) };
    }
  } else if (typeof model === 'string') {
    return normalizeModelRefString(model);
  }
  return model;
}

export function needsMigration(): boolean {
  const newConfigDir = getOpenClawConfigDir();
  const markerPath = join(newConfigDir, MIGRATION_MARKER_FILE);
  if (existsSync(markerPath)) return false;
  if (existsSync(newConfigDir)) return false;
  const legacyConfigPath = join(getLegacyOpenClawConfigDir(), 'openclaw.json');
  return existsSync(legacyConfigPath);
}

export function runFirstLaunchMigration(): boolean {
  if (!needsMigration()) return false;

  const legacyDir = getLegacyOpenClawConfigDir();
  const newDir = getOpenClawConfigDir();
  const legacyConfigPath = join(legacyDir, 'openclaw.json');

  try {
    const raw = readFileSync(legacyConfigPath, 'utf-8');
    const legacyConfig = JSON.parse(raw) as Record<string, unknown>;

    // Only import provider/API key settings and gateway config.
    // Do NOT import: agents (workspace paths bound to the legacy global
    // OpenClaw directory), channels (plugin state in that legacy directory),
    // sessions, skills.
    const migrated: Record<string, unknown> = {};

    if (legacyConfig.providers && typeof legacyConfig.providers === 'object') {
      migrated.providers = { ...(legacyConfig.providers as Record<string, unknown>) };
    }

    if (legacyConfig.agents && typeof legacyConfig.agents === 'object') {
      const agents = legacyConfig.agents as Record<string, unknown>;
      const defaults = agents.defaults as Record<string, unknown> | undefined;
      migrated.agents = {
        defaults: {
          ...(defaults?.model ? { model: sanitizeModelRef(defaults.model) } : {}),
          ...(defaults?.provider ? { provider: defaults.provider } : {}),
        },
      };
    }

    if (legacyConfig.gateway && typeof legacyConfig.gateway === 'object') {
      migrated.gateway = { ...(legacyConfig.gateway as Record<string, unknown>) };
    }

    ensureDir(newDir);
    writeFileSync(join(newDir, 'openclaw.json'), JSON.stringify(migrated, null, 2), 'utf-8');
    writeFileSync(join(newDir, MIGRATION_MARKER_FILE), new Date().toISOString(), 'utf-8');

    logger.info('Migrated OpenClaw config', { from: legacyDir, to: newDir });
    return true;
  } catch (err) {
    logger.warn('Failed to migrate OpenClaw config', { error: String(err) });
    ensureDir(newDir);
    writeFileSync(join(newDir, MIGRATION_MARKER_FILE), new Date().toISOString(), 'utf-8');
    return false;
  }
}

/**
 * Migrate auth-profiles.json from legacy agents to the isolated directory.
 * Runs independently of the main config migration so it can execute even
 * when the main migration marker already exists (e.g. first-run already
 * completed but auth was missing).
 */
export function runAuthProfilesMigration(): boolean {
  const newDir = getOpenClawConfigDir();
  const markerPath = join(newDir, AUTH_MIGRATION_MARKER_FILE);
  if (existsSync(markerPath)) return false;

  const legacyDir = getLegacyOpenClawConfigDir();
  const legacyAgentsDir = join(legacyDir, 'agents');
  if (!existsSync(legacyAgentsDir)) {
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    return false;
  }

  let migrated = 0;
  try {
    const agentDirs = readdirSync(legacyAgentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const agentId of agentDirs) {
      const legacyAuthPath = join(legacyAgentsDir, agentId, 'agent', 'auth-profiles.json');
      if (!existsSync(legacyAuthPath)) continue;

      const newAgentAuthDir = join(newDir, 'agents', agentId, 'agent');
      const newAuthPath = join(newAgentAuthDir, 'auth-profiles.json');

      const legacyProfiles = JSON.parse(readFileSync(legacyAuthPath, 'utf-8')) as {
        version?: number;
        profiles?: Record<string, Record<string, unknown>>;
        order?: Record<string, string[]>;
        lastGood?: Record<string, string>;
      };

      let merged = { version: 1, profiles: {}, order: {}, lastGood: {} } as {
        version: number;
        profiles: Record<string, Record<string, unknown>>;
        order: Record<string, string[]>;
        lastGood: Record<string, string>;
      };

      if (existsSync(newAuthPath)) {
        merged = JSON.parse(readFileSync(newAuthPath, 'utf-8')) as typeof merged;
      }

      if (legacyProfiles.profiles) {
        for (const [key, profile] of Object.entries(legacyProfiles.profiles)) {
          if (!merged.profiles[key]) {
            merged.profiles[key] = profile;
          }
        }
      }

      if (legacyProfiles.order) {
        for (const [provider, ids] of Object.entries(legacyProfiles.order)) {
          if (!merged.order[provider]) {
            merged.order[provider] = ids;
          }
        }
      }

      if (legacyProfiles.lastGood) {
        for (const [provider, id] of Object.entries(legacyProfiles.lastGood)) {
          if (!merged.lastGood[provider]) {
            merged.lastGood[provider] = id;
          }
        }
      }

      mkdirSync(newAgentAuthDir, { recursive: true });
      writeFileSync(newAuthPath, JSON.stringify(merged, null, 2), 'utf-8');
      migrated++;
    }

    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    if (migrated > 0) {
      logger.info(`Migrated auth profiles from ${migrated} legacy agent(s)`, {
        from: legacyAgentsDir,
        to: join(newDir, 'agents'),
      });
    }
    return migrated > 0;
  } catch (err) {
    logger.warn('Failed to migrate auth profiles', { error: String(err) });
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    return false;
  }
}
