import { completeSetup, expect, test } from './fixtures/electron';

test.describe('BoostClaw developer-mode gated UI', () => {
  test('keeps developer-only configuration hidden from settings UI', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveCount(0);

    await page.getByTestId('sidebar-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expect(page.getByTestId('add-provider-model-id-input')).toHaveCount(0);
    await page.getByTestId('add-provider-close-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);
  });
});
