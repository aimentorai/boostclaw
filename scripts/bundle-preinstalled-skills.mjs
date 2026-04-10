#!/usr/bin/env zx

import 'zx/globals';
import { quotePowerShell } from 'zx';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32' && !$.quote) {
  $.quote = quotePowerShell;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    const hasLocalSource = typeof item.localPath === 'string' && item.localPath.trim().length > 0;
    const hasRepoSource = item.repo && item.repoPath;
    if (!item.slug || (!hasLocalSource && !hasRepoSource)) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function runGit(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
  } catch (err) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
    const stdout = typeof err.stdout === 'string' ? err.stdout.trim() : '';
    const message = stderr || stdout || err.message || `git failed (exit ${err.status})`;
    const wrapped = new Error(message);
    wrapped.exitCode = err.status;
    throw wrapped;
  }
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

function copyLocalSkill(entry) {
  const sourceDir = join(ROOT, entry.localPath);
  const targetDir = join(OUTPUT_ROOT, entry.slug);

  if (!existsSync(sourceDir)) {
    throw new Error(`Missing local skill path: ${entry.localPath}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

  const skillManifest = join(targetDir, 'SKILL.md');
  if (!existsSync(skillManifest)) {
    throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
  }

  const version = (entry.version || 'local').trim() || 'local';
  lock.skills.push({
    slug: entry.slug,
    version,
    localPath: entry.localPath,
  });

  echo`   OK ${entry.slug} (local)`;
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        // Some Windows images expose bsdtar instead of tar.
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  // Use execFileSync (no shell) so paths are not mangled by PowerShell quoting (zx $`...`).
  runGit(['init', checkoutDir]);
  runGit(['-C', checkoutDir, 'remote', 'add', 'origin', remote]);
  runGit(['-C', checkoutDir, 'fetch', '--depth', '1', 'origin', ref]);
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  runGit([
    '-C',
    checkoutDir,
    'archive',
    '--format=tar',
    '--output',
    archivePath,
    'FETCH_HEAD',
    ...archivePaths,
  ]);
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  return runGit(['-C', checkoutDir, 'rev-parse', 'FETCH_HEAD']).trim();
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const localSkills = manifestSkills.filter((entry) => typeof entry.localPath === 'string' && entry.localPath.trim().length > 0);
const remoteSkills = manifestSkills.filter((entry) => !(typeof entry.localPath === 'string' && entry.localPath.trim().length > 0));

if (localSkills.length > 0) {
  echo`Copying local preinstalled skills...`;
  for (const entry of localSkills) {
    copyLocalSkill(entry);
  }
}

const groups = groupByRepoRef(remoteSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
