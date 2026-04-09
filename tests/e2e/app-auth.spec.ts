import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('Boostclaw app auth', () => {
  test('shows login page when app auth is enabled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ enableAppAuth: true });
    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('login-page')).toBeVisible();
      await expect(window.getByTestId('main-layout')).toHaveCount(0);
      await expect(window.getByTestId('login-start-button')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
