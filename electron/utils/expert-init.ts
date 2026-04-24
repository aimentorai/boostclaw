/**
 * Expert Initialization Service
 *
 * Reads the expert manifest, creates underlying agents for each expert,
 * writes custom bootstrap files, and triggers skill installation.
 * Runs during app startup or first launch after update.
 */
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import {
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
} from './agent-config';
import { expandPath, getOpenClawConfigDir, getResourcesDir } from './paths';
import * as logger from './logger';

export interface ExpertManifestEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  systemPrompt: string;
  identityPrompt: string;
  welcomeMessage: string;
  suggestedPrompts: string[];
  requiredSkills: string[];
  defaultModel?: string;
  usageTips: string[];
  enabled: boolean;
  version?: number;
}

export interface ExpertManifest {
  removedExperts?: string[];
  experts: ExpertManifestEntry[];
}

export interface ExpertInitResult {
  expertId: string;
  agentId: string;
  status: 'created' | 'existing' | 'failed';
  failedSkills?: string[];
  error?: string;
}

const EXPERT_MARKER_FILENAME = 'EXPERT_ID';

/**
 * Stale agent IDs created before the fix that used Chinese names,
 * which slugifyAgentId() stripped to the fallback "agent" / "agent-N".
 */
const STALE_AGENT_ID_RE = /^agent(-\d+)?$/;

function isStaleAgentId(agentId: string): boolean {
  return STALE_AGENT_ID_RE.test(agentId);
}

/**
 * Read the pre-installed expert manifest from the bundled resources.
 */
export async function readExpertManifest(): Promise<ExpertManifest> {
  const manifestPath = join(getResourcesDir(), 'experts', 'preinstalled-manifest.json');

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as ExpertManifest;
  } catch (err) {
    logger.warn('Expert manifest not found or invalid:', err);
    return { experts: [] };
  }
}

interface ExpertMarker {
  expertId: string;
  version: number;
}

/**
 * Read the EXPERT_ID marker from an agent's directory.
 * Marker format: first line = expertId, second line = version (default 0).
 */
async function readExpertMarker(agentId: string): Promise<ExpertMarker | null> {
  try {
    const agentDir = join(getOpenClawConfigDir(), 'agents', agentId, 'agent');
    const markerPath = join(agentDir, EXPERT_MARKER_FILENAME);
    const content = await readFile(markerPath, 'utf-8');
    const trimmed = content.trim();
    if (!trimmed) return null;
    const lines = trimmed.split('\n');
    return {
      expertId: lines[0],
      version: lines.length > 1 ? parseInt(lines[1], 10) || 0 : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Write the EXPERT_ID marker file to an agent's directory.
 * Marker format: expertId\nversion
 */
async function writeExpertMarker(agentId: string, expert: ExpertManifestEntry): Promise<void> {
  const agentDir = join(getOpenClawConfigDir(), 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  const markerPath = join(agentDir, EXPERT_MARKER_FILENAME);
  const version = expert.version ?? 1;
  await writeFile(markerPath, `${expert.id}\n${version}`, 'utf-8');
}

export const SPARKBOOST_SKILLS = new Set([
  'product-scout',
  'content-craft',
  'tiktok-publish',
  'video-maker',
  'auto-publish-pipeline',
]);

export function expertUsesSparkBoost(expert: ExpertManifestEntry): boolean {
  return expert.requiredSkills.some((s) => SPARKBOOST_SKILLS.has(s));
}

export async function readPluginToolsMd(pluginId: string): Promise<string | null> {
  const toolsPath = join(getResourcesDir(), 'openclaw-plugins', pluginId, 'docs', 'TOOLS.md');
  try {
    return await readFile(toolsPath, 'utf-8');
  } catch {
    return null;
  }
}

export function generateUserMd(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN';
  return `- 时区: ${tz}\n- 语言: ${locale}\n- 业务场景: TikTok 跨境电商营销\n`;
}

/**
 * Write custom bootstrap files (SOUL.md, IDENTITY.md, TOOLS.md, USER.md) to an agent's workspace.
 */
async function writeExpertBootstrapFiles(
  workspacePath: string,
  expert: ExpertManifestEntry
): Promise<void> {
  const workspace = expandPath(workspacePath);
  if (expert.systemPrompt) {
    await writeFile(join(workspace, 'SOUL.md'), expert.systemPrompt, 'utf-8');
  }
  if (expert.identityPrompt) {
    await writeFile(join(workspace, 'IDENTITY.md'), expert.identityPrompt, 'utf-8');
  }
  // TOOLS.md — for any expert using SparkBoost skills
  if (expertUsesSparkBoost(expert)) {
    const toolsMd = await readPluginToolsMd('sparkboost');
    if (toolsMd) {
      await writeFile(join(workspace, 'TOOLS.md'), toolsMd, 'utf-8');
    }
  }
  // USER.md — all experts
  await writeFile(join(workspace, 'USER.md'), generateUserMd(), 'utf-8');
}

/**
 * Find an existing agent by checking EXPERT_ID markers.
 * Returns the agent ID if found, null otherwise.
 */
async function findExistingExpertAgent(expertId: string): Promise<string | null> {
  try {
    const snapshot = await listAgentsSnapshot();
    for (const agent of snapshot.agents) {
      const marker = await readExpertMarker(agent.id);
      if (marker && marker.expertId === expertId) {
        return agent.id;
      }
    }
  } catch (err) {
    logger.warn('Failed to check existing expert agents:', err);
  }
  return null;
}

/**
 * Initialize all pre-installed experts.
 *
 * For each enabled expert in the manifest:
 * 1. Check if the underlying agent already exists (via EXPERT_ID marker)
 * 2. If not, create it and write custom bootstrap files
 * 3. Return status for each expert
 *
 * Skill installation is handled separately by the renderer process
 * via the skills store, since it needs the Gateway RPC.
 */
export async function initializeExperts(): Promise<ExpertInitResult[]> {
  const manifest = await readExpertManifest();
  const results: ExpertInitResult[] = [];

  for (const expert of manifest.experts) {
    if (!expert.enabled) continue;

    try {
      // Check if agent already exists for this expert
      const existingAgentId = await findExistingExpertAgent(expert.id);

      if (existingAgentId) {
        if (isStaleAgentId(existingAgentId)) {
          logger.info('Cleaning up stale expert agent', {
            expertId: expert.id,
            staleAgentId: existingAgentId,
          });
          try {
            const { removedEntry } = await deleteAgentConfig(existingAgentId);
            await removeAgentWorkspaceDirectory(removedEntry);
          } catch (err) {
            logger.error('Failed to clean up stale expert agent', {
              expertId: expert.id,
              staleAgentId: existingAgentId,
              error: String(err),
            });
          }
        } else {
          // Clean up runtime files copied by older versions
          const agentDir = join(getOpenClawConfigDir(), 'agents', existingAgentId, 'agent');
          for (const fileName of ['models.json', 'auth-profiles.json']) {
            const filePath = join(agentDir, fileName);
            try {
              await unlink(filePath);
            } catch {
              /* ENOENT is fine */
            }
          }

          // Check if bootstrap files need updating (version bump)
          const existingSnapshot = await listAgentsSnapshot();
          const existingEntry = existingSnapshot.agents.find((a) => a.id === existingAgentId);
          const marker = await readExpertMarker(existingAgentId);
          const storedVersion = marker?.version ?? 0;
          const manifestVersion = expert.version ?? 1;
          if (storedVersion < manifestVersion) {
            if (existingEntry?.workspace) {
              await writeExpertBootstrapFiles(existingEntry.workspace, expert);
            }
            await writeExpertMarker(existingAgentId, expert);
            logger.info('Updated expert bootstrap files', {
              expertId: expert.id,
              fromVersion: storedVersion,
              toVersion: manifestVersion,
            });
          }

          logger.info('Expert agent already exists', {
            expertId: expert.id,
            agentId: existingAgentId,
          });
          results.push({
            expertId: expert.id,
            agentId: existingAgentId,
            status: 'existing',
          });
          continue;
        }
      }

      // Create new agent — use expert.id (ASCII slug) as the agent name
      // so that slugifyAgentId produces a stable, unique ID instead of
      // the Chinese fallback "agent".
      const snapshot = await createAgent(expert.id, { skipRuntimeFiles: true });
      // createAgent appends the new entry at the end of the agents list.
      const newAgent = snapshot.agents[snapshot.agents.length - 1];

      if (!newAgent) {
        throw new Error(
          `Agent creation for expert "${expert.id}" did not produce an agent with matching name. ` +
            `Snapshot contains: [${snapshot.agents.map((a) => a.name).join(', ')}]`
        );
      }

      const agentId = newAgent.id;
      const workspace = newAgent.workspace;

      // Write custom bootstrap files
      await writeExpertBootstrapFiles(workspace, expert);

      // Write EXPERT_ID marker
      await writeExpertMarker(agentId, expert);

      logger.info('Created expert agent', { expertId: expert.id, agentId });
      results.push({
        expertId: expert.id,
        agentId,
        status: 'created',
      });
    } catch (err) {
      logger.error('Failed to initialize expert', { expertId: expert.id, error: String(err) });
      results.push({
        expertId: expert.id,
        agentId: '',
        status: 'failed',
        error: String(err),
      });
    }
  }

  // Clean up orphaned and duplicate expert agents
  const manifestIds = new Set(manifest.experts.filter((e) => e.enabled).map((e) => e.id));
  const removedIds = new Set(manifest.removedExperts ?? []);
  const allKnownExpertIds = new Set([...manifestIds, ...removedIds]);
  try {
    const snapshot = await listAgentsSnapshot();

    // Pass 1: marker-based grouping (reliable)
    const byExpertId = new Map<string, string[]>();
    const markedAgentIds = new Set<string>();
    for (const agent of snapshot.agents) {
      const marker = await readExpertMarker(agent.id);
      if (marker) {
        markedAgentIds.add(agent.id);
        const list = byExpertId.get(marker.expertId) ?? [];
        list.push(agent.id);
        byExpertId.set(marker.expertId, list);
      }
    }

    // Pass 2: match unmarked agents by name/ID against known expert IDs
    for (const agent of snapshot.agents) {
      if (markedAgentIds.has(agent.id)) continue;
      for (const expertId of allKnownExpertIds) {
        if (
          agent.name === expertId ||
          agent.id === expertId ||
          agent.id.startsWith(expertId + '-')
        ) {
          const list = byExpertId.get(expertId) ?? [];
          list.push(agent.id);
          byExpertId.set(expertId, list);
          break;
        }
      }
    }

    for (const [expertId, agentIds] of byExpertId) {
      if (!manifestIds.has(expertId)) {
        // Orphaned — expert no longer in manifest, remove all its agents
        for (const agentId of agentIds) {
          logger.info('Removing orphaned expert agent', { agentId, expertId });
          try {
            const { removedEntry } = await deleteAgentConfig(agentId);
            await removeAgentWorkspaceDirectory(removedEntry);
          } catch (err) {
            logger.error('Failed to remove orphaned expert agent', {
              agentId,
              expertId,
              error: String(err),
            });
          }
        }
      } else if (agentIds.length > 1) {
        // Duplicate — keep the first marked agent, or the first one if none are marked
        const markedForThisExpert = agentIds.filter((id) => markedAgentIds.has(id));
        const keeper = markedForThisExpert[0] ?? agentIds[0];
        const toRemove = agentIds.filter((id) => id !== keeper);
        for (const agentId of toRemove) {
          logger.info('Removing duplicate expert agent', { agentId, expertId });
          try {
            const { removedEntry } = await deleteAgentConfig(agentId);
            await removeAgentWorkspaceDirectory(removedEntry);
          } catch (err) {
            logger.error('Failed to remove duplicate expert agent', {
              agentId,
              expertId,
              error: String(err),
            });
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to check for orphaned expert agents:', err);
  }

  return results;
}

/**
 * Get the list of experts that need skill installation.
 * Called by the renderer to trigger skill installation via Gateway RPC.
 */
export async function getExpertsRequiringSkills(): Promise<
  { expertId: string; agentId: string; requiredSkills: string[] }[]
> {
  const manifest = await readExpertManifest();
  const results: { expertId: string; agentId: string; requiredSkills: string[] }[] = [];

  for (const expert of manifest.experts) {
    if (!expert.enabled || expert.requiredSkills.length === 0) continue;

    const agentId = await findExistingExpertAgent(expert.id);
    if (agentId) {
      results.push({
        expertId: expert.id,
        agentId,
        requiredSkills: expert.requiredSkills,
      });
    }
  }

  return results;
}
