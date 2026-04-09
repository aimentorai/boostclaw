import { completeSetup, expect, test } from './fixtures/electron';

test.describe('BoostClaw developer proxy settings', () => {
  test('keeps developer proxy controls hidden from settings UI', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveCount(0);
    await expect(page.getByTestId('settings-proxy-section')).toHaveCount(0);
    await expect(page.getByTestId('settings-proxy-toggle')).toHaveCount(0);
    await expect(page.getByTestId('settings-proxy-save-button')).toHaveCount(0);
  });
});
