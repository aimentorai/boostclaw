import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw chat model picker', () => {
  test('lists provider default models for configured accounts and applies the selection', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.evaluate(async () => {
        const now = new Date().toISOString();

        await window.electron.ipcRenderer.invoke('hostapi:fetch', {
          path: '/api/provider-accounts',
          method: 'POST',
          body: JSON.stringify({
            account: {
              id: 'openai-e2e',
              vendorId: 'openai',
              label: 'OpenAI Primary',
              authMode: 'api_key',
              enabled: true,
              isDefault: false,
              createdAt: now,
              updatedAt: now,
            },
            apiKey: 'sk-test-openai',
          }),
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await page.reload();
      await expect(page.getByTestId('chat-composer-shell')).toBeVisible();

      const modelPickerButton = page.getByTestId('chat-model-picker-button');
      await modelPickerButton.click();

      await expect(page.getByTestId('chat-model-option-openai-gpt-5.4')).toBeVisible();
      await page.getByTestId('chat-model-option-openai-gpt-5.4').click();

      await expect(modelPickerButton).toContainText('gpt-5.4');
    } finally {
      await closeElectronApp(app);
    }
  });
});
