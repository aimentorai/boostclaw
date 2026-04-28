import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw chat model picker', () => {
  test('lists configured provider models and vendor model presets', async ({
    launchElectronApp,
  }) => {
    const previousAuthEnabled = process.env.BoostClaw_APP_AUTH_ENABLED;
    process.env.BoostClaw_APP_AUTH_ENABLED = '0';
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
              id: 'qwen-e2e',
              vendorId: 'qwen',
              label: 'Qwen Primary',
              authMode: 'api_key',
              model: 'qwen3.5-plus',
              fallbackModels: ['qwen3-coder-plus'],
              enabled: true,
              isDefault: false,
              createdAt: now,
              updatedAt: now,
            },
            apiKey: 'sk-test-qwen',
          }),
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await page.reload();
      await expect(page.getByTestId('chat-composer-shell')).toBeVisible();

      const modelPickerButton = page.getByTestId('chat-model-picker-button');
      await expect(modelPickerButton).toBeEnabled();
      await modelPickerButton.click();

      await expect(page.getByTestId('chat-model-option-qwen-qwen3.5-plus')).toBeVisible();
      await expect(page.getByTestId('chat-model-option-qwen-qwen3-coder-plus')).toBeVisible();
      await expect(page.getByTestId('chat-model-option-qwen-qwen3.6-plus')).toBeVisible();
      await page.getByTestId('chat-model-option-qwen-qwen3.6-plus').click();

      await expect(modelPickerButton).toContainText('qwen3.6-plus');
      const snapshot = await page.evaluate(async () => {
        const response = await window.electron.ipcRenderer.invoke('hostapi:fetch', {
          path: '/api/agents',
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        return response.data?.json ?? response.json;
      });
      const agents = (
        snapshot as { agents: Array<{ id: string; overrideModelRef?: string | null }> }
      ).agents;
      expect(agents.find((agent) => agent.id === 'main')?.overrideModelRef).toBe(
        'qwen/qwen3.6-plus'
      );
    } finally {
      await closeElectronApp(app);
      if (previousAuthEnabled === undefined) {
        delete process.env.BoostClaw_APP_AUTH_ENABLED;
      } else {
        process.env.BoostClaw_APP_AUTH_ENABLED = previousAuthEnabled;
      }
    }
  });
});
