#!/usr/bin/env zx

import 'zx/globals';

const ROOT = path.resolve(__dirname, '..');

async function findCanonicalTypebox() {
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  let entries = [];
  try {
    entries = fs.readdirSync(store);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.startsWith('typebox@')) {
      continue;
    }
    const candidate = path.join(store, entry, 'node_modules', 'typebox');
    if (fs.existsSync(path.join(candidate, 'build', 'guard', 'string.mjs'))) {
      return candidate;
    }
  }
  return null;
}

async function findNestedTypeboxTargets() {
  return glob('{node_modules/openclaw,build/openclaw}/dist/extensions/**/node_modules/typebox', {
    cwd: ROOT,
    absolute: true,
  });
}

const source = await findCanonicalTypebox();
if (!source) {
  echo(chalk.yellow`⚠️  typebox@1.x package not found; skipping OpenClaw typebox patch.`);
  process.exit(0);
}

let patched = 0;
for (const target of await findNestedTypeboxTargets()) {
  const guard = path.join(target, 'build', 'guard', 'guard.mjs');
  const missingStringGuard = !fs.existsSync(path.join(target, 'build', 'guard', 'string.mjs'));
  if (!fs.existsSync(guard) || !missingStringGuard) {
    continue;
  }
  fs.cpSync(source, target, { recursive: true, force: true, dereference: true });
  patched += 1;
  echo`🩹 Patched OpenClaw nested typebox: ${path.relative(ROOT, target)}`;
}

if (patched === 0) {
  echo`✅ OpenClaw nested typebox packages are complete.`;
} else {
  echo(chalk.green`✅ Patched ${patched} OpenClaw nested typebox package(s).`);
}
