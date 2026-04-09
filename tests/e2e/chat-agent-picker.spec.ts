import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw chat agent picker', () => {
  test('supports selecting a target agent from the chat composer', async ({ launchElectronApp }) => {
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

      await pickerButton.click();
      await expect(page.getByTestId('chat-agent-option-current')).toBeVisible();
      await page.getByTestId('chat-agent-option-research').click();

      await expect(page.getByTestId('chat-agent-picker-button')).toContainText('Research');
      await expect(page.getByText('@Research')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
