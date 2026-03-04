import { access, cp, mkdir, readFile, rm } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger';

const DINGTALK_PLUGIN_ID = 'dingtalk';
const OPENCLAW_HOME_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_HOME_DIR, 'openclaw.json');
const DINGTALK_EXTENSION_DIR = join(OPENCLAW_HOME_DIR, 'extensions', DINGTALK_PLUGIN_ID);
const DINGTALK_EXTENSION_MANIFEST = join(DINGTALK_EXTENSION_DIR, 'openclaw.plugin.json');

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface DingTalkInstallResult {
  installed: boolean;
  warning?: string;
  sourceDir?: string;
}

export interface DingTalkStartupCompatibilityResult {
  detectedConfigReferences: boolean;
  installAttempted: boolean;
  installed: boolean;
  warning?: string;
}

export function hasDingTalkConfigReferences(config: Record<string, unknown>): boolean {
  const channels = (config.channels && typeof config.channels === 'object')
    ? config.channels as Record<string, unknown>
    : undefined;
  if (channels && channels.dingtalk !== undefined) {
    return true;
  }

  const plugins = (config.plugins && typeof config.plugins === 'object')
    ? config.plugins as Record<string, unknown>
    : undefined;
  if (!plugins) return false;

  const allow = Array.isArray(plugins.allow) ? plugins.allow as unknown[] : [];
  if (allow.some((entry) => entry === DINGTALK_PLUGIN_ID)) {
    return true;
  }

  const entries = (plugins.entries && typeof plugins.entries === 'object')
    ? plugins.entries as Record<string, unknown>
    : undefined;
  return entries?.dingtalk !== undefined;
}

export function resolveDingTalkPluginCandidateSources(params: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  cwd: string;
  currentDir: string;
}): string[] {
  if (params.isPackaged) {
    return [
      join(params.resourcesPath, 'openclaw-plugins', DINGTALK_PLUGIN_ID),
      join(params.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', DINGTALK_PLUGIN_ID),
      join(params.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', DINGTALK_PLUGIN_ID),
    ];
  }

  return [
    join(params.appPath, 'build', 'openclaw-plugins', DINGTALK_PLUGIN_ID),
    join(params.cwd, 'build', 'openclaw-plugins', DINGTALK_PLUGIN_ID),
    join(params.currentDir, '../../build/openclaw-plugins', DINGTALK_PLUGIN_ID),
  ];
}

export async function isDingTalkPluginInstalled(): Promise<boolean> {
  return fileExists(DINGTALK_EXTENSION_MANIFEST);
}

export async function ensureDingTalkPluginInstalled(): Promise<DingTalkInstallResult> {
  if (await isDingTalkPluginInstalled()) {
    logger.info('DingTalk plugin already installed from local mirror');
    return { installed: true };
  }

  const { app } = await import('electron');
  const candidateSources = resolveDingTalkPluginCandidateSources({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    currentDir: __dirname,
  });

  let sourceDir: string | undefined;
  for (const dir of candidateSources) {
    if (await fileExists(join(dir, 'openclaw.plugin.json'))) {
      sourceDir = dir;
      break;
    }
  }

  if (!sourceDir) {
    logger.warn('Bundled DingTalk plugin mirror not found in candidate paths', { candidateSources });
    return {
      installed: false,
      warning: `Bundled DingTalk plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    await mkdir(join(OPENCLAW_HOME_DIR, 'extensions'), { recursive: true });
    await rm(DINGTALK_EXTENSION_DIR, { recursive: true, force: true });
    await cp(sourceDir, DINGTALK_EXTENSION_DIR, { recursive: true, dereference: true });

    if (!(await fileExists(DINGTALK_EXTENSION_MANIFEST))) {
      return { installed: false, warning: 'Failed to install DingTalk plugin mirror (manifest missing).' };
    }

    logger.info(`Installed DingTalk plugin from bundled mirror: ${sourceDir}`);
    return { installed: true, sourceDir };
  } catch (error) {
    logger.warn('Failed to install DingTalk plugin from bundled mirror:', error);
    return {
      installed: false,
      warning: 'Failed to install bundled DingTalk plugin mirror',
    };
  }
}

export async function ensureDingTalkStartupCompatibility(): Promise<DingTalkStartupCompatibilityResult> {
  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    return {
      detectedConfigReferences: false,
      installAttempted: false,
      installed: await isDingTalkPluginInstalled(),
    };
  }

  let configRaw = '';
  try {
    configRaw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
  } catch (error) {
    logger.warn('Failed reading openclaw.json during DingTalk startup preflight:', error);
    return {
      detectedConfigReferences: false,
      installAttempted: false,
      installed: await isDingTalkPluginInstalled(),
      warning: 'Failed reading openclaw.json during DingTalk startup preflight',
    };
  }

  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(configRaw) as Record<string, unknown>;
  } catch (error) {
    logger.warn('Failed parsing openclaw.json during DingTalk startup preflight:', error);
    return {
      detectedConfigReferences: false,
      installAttempted: false,
      installed: await isDingTalkPluginInstalled(),
      warning: 'Failed parsing openclaw.json during DingTalk startup preflight',
    };
  }

  if (!hasDingTalkConfigReferences(parsedConfig)) {
    return {
      detectedConfigReferences: false,
      installAttempted: false,
      installed: await isDingTalkPluginInstalled(),
    };
  }

  logger.info('Detected DingTalk references in openclaw.json during startup preflight');
  const installResult = await ensureDingTalkPluginInstalled();
  if (!installResult.installed) {
    logger.warn(`DingTalk startup preflight could not ensure plugin install: ${installResult.warning || 'unknown reason'}`);
  } else {
    logger.info('DingTalk startup preflight ensured plugin installation');
  }

  return {
    detectedConfigReferences: true,
    installAttempted: true,
    installed: installResult.installed,
    warning: installResult.warning,
  };
}
