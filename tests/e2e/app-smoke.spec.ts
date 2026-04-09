import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('Boostclaw Electron smoke flows', () => {
  test('opens main layout on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('setup-page')).toHaveCount(0);
  });

  test('can navigate to the models page', async ({ page }) => {
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('does not show setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await expect(firstWindow.getByTestId('main-layout')).toBeVisible();
    await expect(firstWindow.getByTestId('setup-page')).toHaveCount(0);

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
