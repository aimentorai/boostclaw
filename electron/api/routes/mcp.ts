/**
 * MCP Server API Routes
 *
 * REST endpoints for managing MCP server configurations stored in
 * ~/.boostclaw/openclaw/openclaw.json under mcp.servers.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  listMcpServers,
  getMcpServer,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
} from '../../services/mcp/mcp-server-store';
import { logger } from '../../utils/logger';

export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // ── GET /api/mcp/servers — list all MCP servers ──────────────────
  if (url.pathname === '/api/mcp/servers' && req.method === 'GET') {
    try {
      const servers = await listMcpServers();
      sendJson(res, 200, { success: true, servers });
    } catch (error) {
      logger.warn('[MCP] List servers failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ── POST /api/mcp/servers — add a new MCP server ─────────────────
  if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name?: string } & Record<string, unknown>>(req);
      const name = body.name;
      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { success: false, error: 'Server name (name) is required.' });
        return true;
      }
      logger.info(`[MCP] Add server "${name}"`);
      const result = await addMcpServer(name, body);
      if (result.success) {
        sendJson(res, 200, { success: true, server: result.server });
      } else {
        logger.warn(`[MCP] Add server "${name}" failed: ${result.error}`);
        sendJson(res, 400, { success: false, error: result.error });
      }
    } catch (error) {
      logger.warn('[MCP] Add server failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ── /api/mcp/servers/:name — name-based sub-routes ───────────────
  const serverMatch = url.pathname.match(/^\/api\/mcp\/servers\/(.+)$/);
  if (serverMatch) {
    const serverName = decodeURIComponent(serverMatch[1]);

    // GET — get a single server's full details
    if (req.method === 'GET') {
      try {
        const server = await getMcpServer(serverName);
        if (!server) {
          sendJson(res, 404, { success: false, error: `MCP server "${serverName}" not found.` });
        } else {
          sendJson(res, 200, { success: true, server });
        }
      } catch (error) {
        logger.warn(`[MCP] Get server "${serverName}" failed:`, error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // PUT — update an existing server
    if (req.method === 'PUT') {
      try {
        const body = await parseJsonBody<Record<string, unknown>>(req);
        logger.info(`[MCP] Update server "${serverName}"`);
        const result = await updateMcpServer(serverName, body);
        if (result.success) {
          sendJson(res, 200, { success: true, server: result.server });
        } else {
          logger.warn(`[MCP] Update server "${serverName}" failed: ${result.error}`);
          const status = result.error?.includes('not found') ? 404 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
        logger.warn(`[MCP] Update server "${serverName}" failed:`, error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // DELETE — remove a server
    if (req.method === 'DELETE') {
      try {
        logger.info(`[MCP] Delete server "${serverName}"`);
        const result = await deleteMcpServer(serverName);
        if (result.success) {
          sendJson(res, 200, { success: true });
        } else {
          logger.warn(`[MCP] Delete server "${serverName}" failed: ${result.error}`);
          const status = result.error?.includes('not found') ? 404
            : result.error?.includes('Cannot delete subscription') ? 403 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
        logger.warn(`[MCP] Delete server "${serverName}" failed:`, error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // PATCH — toggle enabled state
    if (req.method === 'PATCH') {
      try {
        const body = await parseJsonBody<{ enabled?: boolean }>(req);
        if (typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { success: false, error: 'enabled (boolean) is required.' });
          return true;
        }
        logger.info(`[MCP] Toggle server "${serverName}" enabled=${body.enabled}`);
        const result = await toggleMcpServer(serverName, body.enabled);
        if (result.success) {
          sendJson(res, 200, { success: true, server: result.server });
        } else {
          logger.warn(`[MCP] Toggle server "${serverName}" failed: ${result.error}`);
          const status = result.error?.includes('not found') ? 404 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
        logger.warn(`[MCP] Toggle server "${serverName}" failed:`, error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
