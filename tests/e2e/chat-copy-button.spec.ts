import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('BoostClaw chat copy action', () => {
  test('shows copy buttons on user and assistant messages', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const seededHistory = [
        {
          role: 'user',
          content: 'Copy this user prompt.',
          timestamp: Date.now() - 1000,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'This answer can be copied.' }],
          timestamp: Date.now(),
        },
      ];

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByText('Copy this user prompt.')).toBeVisible();
      await expect(page.getByText('This answer can be copied.')).toBeVisible();

      const userMessageText = page.getByTestId('user-message-text');
      await expect(userMessageText).toHaveCSS(
        'background-color',
        /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/
      );
      const userSelectionBackground = await userMessageText.evaluate((element) =>
        getComputedStyle(element, '::selection').backgroundColor
      );
      expect(userSelectionBackground).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.(3|35)\)/);

      const userCopyButton = page.getByTestId('user-copy-button');
      await expect(userCopyButton).toBeVisible();
      await expect(userCopyButton).toHaveAttribute('title', /Copy|复制|コピー/);
      await expect(userCopyButton).toHaveText('');

      const assistantCopyButton = page.getByTestId('assistant-copy-button');
      await expect(assistantCopyButton).toBeVisible();
      await expect(assistantCopyButton).toHaveAttribute('title', /Copy|复制|コピー/);
      await expect(assistantCopyButton).toHaveText('');
    } finally {
      await closeElectronApp(app);
    }
  });
});
