import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getResourcesDir } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { sendJson } from '../route-utils';

let cachedManifest: object | null = null;

async function readTemplateManifest(): Promise<object> {
  if (cachedManifest) return cachedManifest;

  const manifestPath = join(getResourcesDir(), 'templates', 'templates-manifest.json');
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    cachedManifest = JSON.parse(raw);
    return cachedManifest!;
  } catch (err) {
    logger.warn('Template manifest not found or invalid:', err);
    return { templates: [] };
  }
}

export async function handleTemplateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  if (url.pathname === '/api/templates/manifest' && req.method === 'GET') {
    const manifest = await readTemplateManifest();
    sendJson(res, 200, manifest);
    return true;
  }

  return false;
}
