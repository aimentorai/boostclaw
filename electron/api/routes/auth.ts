import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { appAuthManager } from '../../utils/app-auth';

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.getAuthStatus());
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      sendJson(res, 200, { success: true, ...(await appAuthManager.startLoginFlow()) });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    try {
      await appAuthManager.logout();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
