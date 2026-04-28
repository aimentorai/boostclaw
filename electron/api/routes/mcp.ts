/**
 * MCP Server API Routes
 *
 * REST endpoints for managing MCP server configurations stored in
 * ~/.openclaw/openclaw.json under mcp.servers.
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
      const result = await addMcpServer(name, body);
      if (result.success) {
        sendJson(res, 200, { success: true, server: result.server });
      } else {
        sendJson(res, 400, { success: false, error: result.error });
      }
    } catch (error) {
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
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // PUT — update an existing server
    if (req.method === 'PUT') {
      try {
        const body = await parseJsonBody<Record<string, unknown>>(req);
        const result = await updateMcpServer(serverName, body);
        if (result.success) {
          sendJson(res, 200, { success: true, server: result.server });
        } else {
          const status = result.error?.includes('not found') ? 404 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // DELETE — remove a server
    if (req.method === 'DELETE') {
      try {
        const result = await deleteMcpServer(serverName);
        if (result.success) {
          sendJson(res, 200, { success: true });
        } else {
          const status = result.error?.includes('not found') ? 404
            : result.error?.includes('Cannot delete subscription') ? 403 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
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
        const result = await toggleMcpServer(serverName, body.enabled);
        if (result.success) {
          sendJson(res, 200, { success: true, server: result.server });
        } else {
          const status = result.error?.includes('not found') ? 404 : 400;
          sendJson(res, status, { success: false, error: result.error });
        }
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
