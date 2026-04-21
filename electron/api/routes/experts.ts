import type { IncomingMessage, ServerResponse } from 'http';
import { readExpertManifest } from '../../utils/expert-init';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

/**
 * Expert API routes.
 *
 * GET /api/experts/manifest — Returns the pre-installed expert manifest.
 * GET /api/experts/status   — Returns initialization status for each expert.
 */
export async function handleExpertRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext
): Promise<boolean> {
  if (url.pathname === '/api/experts/manifest' && req.method === 'GET') {
    const manifest = await readExpertManifest();
    sendJson(res, 200, manifest);
    return true;
  }

  return false;
}
