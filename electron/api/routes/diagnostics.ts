import type { IncomingMessage, ServerResponse } from 'http';
import {
  buildExportReport,
  getDiagnosticLogs,
  getDiagnosticSnapshot,
  runFullDiagnostics,
} from '../../utils/diagnostics';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleDiagnosticsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext
): Promise<boolean> {
  // GET /api/diagnostics/snapshot
  if (url.pathname === '/api/diagnostics/snapshot' && req.method === 'GET') {
    sendJson(res, 200, await getDiagnosticSnapshot(ctx));
    return true;
  }

  // POST /api/diagnostics/run — full diagnostic run (bypasses fast path)
  if (url.pathname === '/api/diagnostics/run' && req.method === 'POST') {
    sendJson(res, 200, await runFullDiagnostics(ctx));
    return true;
  }

  // POST /api/diagnostics/fix — execute a fix action
  if (url.pathname === '/api/diagnostics/fix' && req.method === 'POST') {
    const body = await parseJsonBody<{ action?: string }>(req);
    const action = body.action;

    if (!action || typeof action !== 'string') {
      sendJson(res, 400, { ok: false, error: 'Missing or invalid "action" field.' });
      return true;
    }

    const validActions = [
      'restartGateway',
      'runDoctor',
      'runDoctorFix',
      'openLogs',
      'openProviderSettings',
      'openChannelSettings',
      'openProxySettings',
      'openMcpSettings',
    ];

    if (!validActions.includes(action)) {
      sendJson(res, 400, { ok: false, error: `Invalid action "${action}". Valid: ${validActions.join(', ')}` });
      return true;
    }

    try {
      let result: { ok: boolean; detail?: string; error?: string };

      switch (action) {
        case 'restartGateway': {
          await ctx.gatewayManager.restart();
          result = { ok: true, detail: 'Gateway restart initiated.' };
          break;
        }
        case 'runDoctor':
        case 'runDoctorFix': {
          result = { ok: true, detail: `Action "${action}" must be executed via /api/app/openclaw-doctor endpoint.` };
          break;
        }
        case 'openLogs':
        case 'openProviderSettings':
        case 'openChannelSettings':
        case 'openProxySettings':
        case 'openMcpSettings': {
          result = { ok: true, detail: `Navigation action "${action}" acknowledged.` };
          break;
        }
        default:
          result = { ok: false, error: `Unhandled action "${action}".` };
      }

      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  // GET /api/diagnostics/logs — filtered log retrieval
  if (url.pathname === '/api/diagnostics/logs' && req.method === 'GET') {
    const tailLines = parseInt(url.searchParams.get('tailLines') ?? '100', 10);
    const level = url.searchParams.get('level') ?? undefined;
    const query = url.searchParams.get('query') ?? undefined;
    const redact = url.searchParams.get('redact') !== 'false';

    let minLevel: number | undefined;
    if (level) {
      const levelMap: Record<string, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        warning: 2,
        error: 3,
      };
      minLevel = levelMap[level.toLowerCase()];
    }

    const lines = getDiagnosticLogs({
      tailLines: Number.isNaN(tailLines) ? 100 : tailLines,
      level,
      query,
      redact,
      minLevel,
    });

    sendJson(res, 200, {
      lines,
      count: lines.length,
      filtered: !!(level || query),
    });
    return true;
  }

  // GET /api/diagnostics/export — export redacted diagnostic report
  if (url.pathname === '/api/diagnostics/export' && req.method === 'GET') {
    const appVersion = (typeof process.env.APP_VERSION === 'string' && process.env.APP_VERSION) || undefined;
    const platform = process.platform;
    const arch = process.arch;

    const report = await buildExportReport(ctx, {
      appVersion,
      platform,
      arch,
    });

    sendJson(res, 200, report);
    return true;
  }

  return false;
}
