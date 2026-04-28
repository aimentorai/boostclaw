import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw main navigation without setup flow', () => {
  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-screen')).toBeVisible();
      await expect(page.getByTestId('chat-composer-shell')).toBeVisible();
      await expect(page.getByRole('textbox')).toHaveClass(/min-h-\[48px\]/);

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await page.getByTestId('sidebar-nav-experts').click();
      await expect(page.getByTestId('experts-page')).toBeVisible();
      await expect(page.getByTestId('experts-content')).toBeVisible();
      await expect(page.getByText('选品分析')).toBeVisible();
      await expect(page.getByText('Amazon 选品')).toBeVisible();
      await expect(page.getByText('Listing 生成')).toBeVisible();
      const mainContentBox = await page.getByTestId('main-content').boundingBox();
      const expertsContentBox = await page.getByTestId('experts-content').boundingBox();
      expect(mainContentBox).not.toBeNull();
      expect(expertsContentBox).not.toBeNull();
      expect(expertsContentBox!.width).toBeGreaterThan(mainContentBox!.width - 8);

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
