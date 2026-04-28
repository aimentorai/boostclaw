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
  MAIN_AGENT_ID,
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
  /** When true, write config to the main agent's workspace instead of creating a separate agent. */
  mergeToMainAgent?: boolean;
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
  return `- 时区: ${tz}\n- 语言: ${locale}\n- 业务: TikTok 跨境电商\n- 核心需求: 视频营销自动化、选品分析、卖家建联\n- 沟通偏好: 简洁中文、数据驱动\n`;
}

const AGENTS_MD = `# AGENTS.md

## 启动

如果 BOOTSTRAP.md 存在，按其指示操作后删除。使用运行时提供的上下文（AGENTS.md、SOUL.md、USER.md），除非上下文缺失或用户要求，不手动重新读取。

## 记忆

每次会话全新。通过文件保持连续性：
- 日志: memory/YYYY-MM-DD.md — 当天事件
- 长期: MEMORY.md — 精炼的重要记忆

想记住就写到文件。"心理笔记"不跨会话保留。

## 安全边界

- 私人数据不外泄
- 破坏性命令先确认
- trash > rm
- 不确定就问

## 操作权限

自由执行：读文件、搜索、整理、学习
需先确认：发邮件、发帖、任何离开本机的操作
`;

const HEARTBEAT_MD = `# BoostClaw 心跳检查

## 定期检查（每天 2-4 次）
- [ ] TikTok 账号状态是否正常
- [ ] 有无待处理的发布任务
- [ ] AI 视频生成任务是否完成
- [ ] 最近发布是否有失败需关注

## 触达用户
账号异常 | 发布连续失败 | 用户 >8h 未互动且有重要变化

## 静默
无新变化 | 距上次 <30min | 深夜 23:00-08:00
`;

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
    // Append MCP server tool awareness
    const mcpToolsMd = await readPluginToolsMd('proboost-mcp');
    if (mcpToolsMd) {
      const existingTools = await readFile(join(workspace, 'TOOLS.md'), 'utf-8').catch(() => '');
      await writeFile(join(workspace, 'TOOLS.md'), existingTools + '\n\n' + mcpToolsMd, 'utf-8');
    }
  }
  // USER.md — all experts
  await writeFile(join(workspace, 'USER.md'), generateUserMd(), 'utf-8');
  // AGENTS.md — workspace guide
  await writeFile(join(workspace, 'AGENTS.md'), AGENTS_MD, 'utf-8');
  // HEARTBEAT.md — periodic checks
  await writeFile(join(workspace, 'HEARTBEAT.md'), HEARTBEAT_MD, 'utf-8');
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

    // Merged expert: write config to main agent's workspace, no separate agent.
    if (expert.mergeToMainAgent) {
      try {
        // Clean up any existing separate agent for this expert (from before merge)
        const existingSeparateAgent = await findExistingExpertAgent(expert.id);
        if (existingSeparateAgent && existingSeparateAgent !== MAIN_AGENT_ID) {
          logger.info('Removing separate agent for merged expert', {
            expertId: expert.id,
            agentId: existingSeparateAgent,
          });
          try {
            const { removedEntry } = await deleteAgentConfig(existingSeparateAgent);
            await removeAgentWorkspaceDirectory(removedEntry);
          } catch (err) {
            logger.error('Failed to remove separate agent for merged expert', {
              expertId: expert.id,
              agentId: existingSeparateAgent,
              error: String(err),
            });
          }
        }

        // Version check: only rewrite bootstrap files when manifest version bumps
        const marker = await readExpertMarker(MAIN_AGENT_ID);
        const storedVersion = marker?.version ?? 0;
        const manifestVersion = expert.version ?? 1;

        if (storedVersion < manifestVersion) {
          const snapshot = await listAgentsSnapshot();
          const mainEntry = snapshot.agents.find((a) => a.id === MAIN_AGENT_ID);
          if (mainEntry?.workspace) {
            await writeExpertBootstrapFiles(mainEntry.workspace, expert);
          }
          await writeExpertMarker(MAIN_AGENT_ID, expert);
          logger.info('Updated merged expert in main agent', {
            expertId: expert.id,
            fromVersion: storedVersion,
            toVersion: manifestVersion,
          });
        } else {
          logger.info('Merged expert already up to date', {
            expertId: expert.id,
            version: storedVersion,
          });
        }

        results.push({ expertId: expert.id, agentId: MAIN_AGENT_ID, status: 'existing' });
      } catch (err) {
        logger.error('Failed to merge expert into main agent', {
          expertId: expert.id,
          error: String(err),
        });
        results.push({
          expertId: expert.id,
          agentId: MAIN_AGENT_ID,
          status: 'failed',
          error: String(err),
        });
      }
      continue;
    }

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
