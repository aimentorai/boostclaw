import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw provider catalog', () => {
  test('shows only domestic providers in the add-provider dialog', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      await page.getByTestId('providers-add-button').click();
      await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

      await expect(page.getByTestId('add-provider-type-ark')).toBeVisible();
      await expect(page.getByTestId('add-provider-type-moonshot')).toBeVisible();
      await expect(page.getByTestId('add-provider-type-siliconflow')).toBeVisible();
      await expect(page.getByTestId('add-provider-type-deepseek')).toBeVisible();
      await expect(page.getByTestId('add-provider-type-qwen')).toBeVisible();
      await expect(page.getByTestId('add-provider-type-minimax-portal-cn')).toBeVisible();

      await expect(page.getByTestId('add-provider-type-openai')).toHaveCount(0);
      await expect(page.getByTestId('add-provider-type-anthropic')).toHaveCount(0);
      await expect(page.getByTestId('add-provider-type-google')).toHaveCount(0);
      await expect(page.getByTestId('add-provider-type-openrouter')).toHaveCount(0);
      await expect(page.getByTestId('add-provider-type-minimax-portal')).toHaveCount(0);
      await expect(page.getByTestId('add-provider-type-modelstudio')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
