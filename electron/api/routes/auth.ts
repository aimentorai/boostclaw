import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
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

  if (url.pathname === '/api/auth/debug' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.getAuthDebugInfo());
    return true;
  }

  if (url.pathname === '/api/auth/subscription-quotas' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.getSubscriptionQuotaSummary());
    return true;
  }

  if (url.pathname === '/api/auth/subscription-mcp-config' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.syncSubscriptionMcpConfig());
    return true;
  }

  if (url.pathname === '/api/auth/post-login-session' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.getPostLoginSessionCookieInfo());
    return true;
  }

  if (url.pathname === '/api/auth/system-default-model-provider' && req.method === 'GET') {
    sendJson(res, 200, await appAuthManager.getSystemDefaultModelProviderInfo());
    return true;
  }

  if (url.pathname === '/api/auth/mask' && req.method === 'GET') {
    sendJson(res, 200, appAuthManager.getAuthMaskState());
    return true;
  }

  if (url.pathname === '/api/auth/mask' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ enabled?: boolean }>(req);
      sendJson(res, 200, appAuthManager.setAuthMaskEnabled(Boolean(body.enabled)));
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/auth/subscription-auto-trial' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: 'tt' | 'amz' }>(req);
      const provider = body.provider === 'amz' ? 'amz' : 'tt';
      sendJson(res, 200, await appAuthManager.createSubscriptionAutoTrial(provider));
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) });
    }
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
