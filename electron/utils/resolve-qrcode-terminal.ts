/**
 * Resolves paths inside `qrcode-terminal` (e.g. vendor/QRCode/*.js).
 *
 * Tries bundled OpenClaw's node_modules first, then the Electron app's own
 * node_modules (direct dependency) so Windows packaged builds work when the
 * openclaw extraResources bundle omits or dedupes this package.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const require = createRequire(import.meta.url);

/**
 * @param relativeFromPackageRoot Path under the package root, e.g. `vendor/QRCode/index.js`
 * @returns Absolute filesystem path resolvable by `require()`
 */
export function resolveQrcodeTerminalFile(relativeFromPackageRoot: string): string {
  const specifier = `qrcode-terminal/${relativeFromPackageRoot}`;
  const tryResolve = (packageJsonDir: string) =>
    createRequire(join(packageJsonDir, 'package.json')).resolve(specifier);
  const tryDirect = (base: string): string | null => {
    const file = join(base, 'node_modules', 'qrcode-terminal', relativeFromPackageRoot);
    return existsSync(file) ? file : null;
  };

  for (const base of [getOpenClawResolvedDir(), getOpenClawDir()]) {
    try {
      return tryResolve(base);
    } catch {
      const direct = tryDirect(base);
      if (direct) return direct;
    }
  }

  if (process.resourcesPath) {
    const direct = tryDirect(join(process.resourcesPath, 'openclaw'));
    if (direct) return direct;
  }

  try {
    const { app } = require('electron') as typeof import('electron');
    if (app?.getAppPath) {
      return tryResolve(app.getAppPath());
    }
  } catch {
    /* not in Electron main (e.g. tests) */
  }

  try {
    return tryResolve(process.cwd());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to resolve "${specifier}" from OpenClaw bundle or app dependencies. ${reason}`,
      { cause: err }
    );
  }
}
