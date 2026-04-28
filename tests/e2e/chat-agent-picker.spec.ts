import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw chat agent picker', () => {
  test('locks the main agent picker on the default main session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.evaluate(async () => {
        await window.electron.ipcRenderer.invoke('hostapi:fetch', {
          path: '/api/agents',
          method: 'POST',
          body: JSON.stringify({ name: 'Research' }),
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await page.reload();
      await expect(page.getByTestId('chat-composer-shell')).toBeVisible();

      const pickerButton = page.getByTestId('chat-agent-picker-button');
      await expect(pickerButton).toContainText(/Main|main/);
      await expect(pickerButton).toBeDisabled();
    } finally {
      await closeElectronApp(app);
    }
  });
});
