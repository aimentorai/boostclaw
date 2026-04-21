/**
 * Expert Initialization Service
 *
 * Reads the expert manifest, creates underlying agents for each expert,
 * writes custom bootstrap files, and triggers skill installation.
 * Runs during app startup or first launch after update.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createAgent, listAgentsSnapshot } from './agent-config';
import { expandPath, getOpenClawConfigDir } from './paths';
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
}

export interface ExpertManifest {
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
 * Read the pre-installed expert manifest from the bundled resources.
 */
export async function readExpertManifest(): Promise<ExpertManifest> {
  // In production, the manifest is bundled alongside the app.
  // In development, it's at the project root resources/ directory.
  const isDev = !process.env.ELECTRON_BUILD || process.env.NODE_ENV === 'development';
  const manifestPath = isDev
    ? join(process.cwd(), 'resources', 'experts', 'preinstalled-manifest.json')
    : join(
        process.resourcesPath || join(process.cwd(), 'resources'),
        'experts',
        'preinstalled-manifest.json'
      );

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as ExpertManifest;
  } catch (err) {
    logger.warn('Expert manifest not found or invalid:', err);
    return { experts: [] };
  }
}

/**
 * Check if an agent with the given ID has an EXPERT_ID marker.
 */
async function readExpertMarker(agentId: string): Promise<string | null> {
  try {
    const agentDir = join(getOpenClawConfigDir(), 'agents', agentId, 'agent');
    const markerPath = join(agentDir, EXPERT_MARKER_FILENAME);
    const content = await readFile(markerPath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Write the EXPERT_ID marker file to an agent's directory.
 */
async function writeExpertMarker(agentId: string, expertId: string): Promise<void> {
  const agentDir = join(getOpenClawConfigDir(), 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  const markerPath = join(agentDir, EXPERT_MARKER_FILENAME);
  await writeFile(markerPath, expertId, 'utf-8');
}

/**
 * Write custom bootstrap files (SOUL.md, IDENTITY.md) to an agent's workspace.
 */
async function writeExpertBootstrapFiles(
  agentId: string,
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
      if (marker === expertId) {
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

      // Create new agent — use expert.id (ASCII slug) as the agent name
      // so that slugifyAgentId produces a stable, unique ID instead of
      // the Chinese fallback "agent".
      const snapshot = await createAgent(expert.id);
      const newAgent = snapshot.agents.find((a) => a.name === expert.id);

      let agentId: string;
      let workspace: string;

      if (!newAgent) {
        // Fallback: find the most recently added agent
        const allAgents = snapshot.agents;
        const lastAgent = allAgents[allAgents.length - 1];
        if (!lastAgent) {
          throw new Error(`Agent creation returned no agents for expert "${expert.id}"`);
        }
        agentId = lastAgent.id;
        workspace = lastAgent.workspace;
      } else {
        agentId = newAgent.id;
        workspace = newAgent.workspace;
      }

      // Write custom bootstrap files
      await writeExpertBootstrapFiles(agentId, workspace, expert);

      // Write EXPERT_ID marker
      await writeExpertMarker(agentId, expert.id);

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
