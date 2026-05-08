import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('BoostClaw app auth', () => {
  test('shows login page when app auth is enabled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ enableAppAuth: true });
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('login-page')).toBeVisible();
      await expect(window.getByTestId('login-page')).toHaveCSS('background-color', 'rgb(248, 250, 251)');
      await expect(window.getByTestId('main-layout')).toHaveCount(0);
      await expect(window.getByTestId('login-start-button')).toBeVisible();
      await expect(window.getByTestId('login-start-button')).toHaveText('登录');
      await expect(window.getByTestId('login-brand-image')).toBeVisible();
      await expect(window.getByTestId('login-title')).toHaveText('BoostClaw 你的跨境智能助手');
      await expect(window.getByTestId('login-brand-footer')).toHaveText('小数汇智科技');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not show a loading mask window over the redirect page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ enableAppAuth: true });
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('login-page')).toBeVisible();

      await expect.poll(() => app.windows().filter((candidate) => !candidate.isClosed()).length).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('enters the main app after auth success', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ enableAppAuth: true, skipSetup: true });
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('login-page')).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow?.webContents.send('auth:success', {
          authenticated: true,
          profile: { email: 'user@example.com' },
        });
      });

      await expect(window.getByTestId('main-layout')).toBeVisible();
      await expect(window.getByTestId('chat-welcome-screen')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
