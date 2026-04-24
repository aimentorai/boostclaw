import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('BoostClaw settings auth details', () => {
  test('shows subscription actions and model session cookie in settings', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ enableAppAuth: true });

    try {
      const page = await getStableWindow(app);

      await app.evaluate(async () => {
        const { join } = process.mainModule!.require('node:path') as typeof import('node:path');
        const appAuthModulePath = join(process.cwd(), 'dist-electron', 'main', 'utils', 'app-auth.js');
        const secretsModulePath = join(process.cwd(), 'dist-electron', 'main', 'services', 'secrets', 'secret-store.js');
        const { appAuthManager } = process.mainModule!.require(appAuthModulePath) as {
          appAuthManager: {
            getAuthSession: () => { cookies: { set: (cookie: Record<string, unknown>) => Promise<void> } };
            getSubscriptionQuotaSummary: () => Promise<unknown>;
            getPostLoginSessionCookieInfo: () => Promise<unknown>;
            createSubscriptionAutoTrial: (provider: 'tt' | 'amz') => Promise<unknown>;
          };
        };
        const { getSecretStore } = process.mainModule!.require(secretsModulePath) as {
          getSecretStore: () => {
            set: (secret: Record<string, unknown>) => Promise<void>;
          };
        };

        const authSession = appAuthManager.getAuthSession();
        await authSession.cookies.set({
          url: 'https://open.microdata-inc.com/',
          name: 'Auth-Graviteeio-APIM',
          value: 'Bearer%20cookie-token',
          path: '/',
        });

        await getSecretStore().set({
          type: 'oauth',
          accountId: '__BoostClaw_app_auth__',
          accessToken: 'Bearer%20cookie-token',
          refreshToken: '',
          expiresAt: Date.now() + 60_000,
          scopes: ['openid', 'profile'],
          subject: 'subject-123',
          portalUserId: 'user-123',
        });

        appAuthManager.getSubscriptionQuotaSummary = async () => ({
          portalUserId: 'user-123',
          snapshots: [
            { provider: 'tt', ok: true, status: 200, totalQuota: 100, usedQuota: 20, remainingQuota: 80 },
            { provider: 'amz', ok: true, status: 200, totalQuota: 50, usedQuota: 10, remainingQuota: 40 },
          ],
        });
        appAuthManager.getPostLoginSessionCookieInfo = async () => ({
          found: true,
          url: 'https://model.microdata-inc.com',
          name: 'session',
          value: 'session-cookie-value',
        });
        appAuthManager.createSubscriptionAutoTrial = async (provider: 'tt' | 'amz') => ({
          provider,
          ok: true,
          status: 200,
          code: '0',
          message: 'OK',
        });
      });

      await page.reload();
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-auth-subscription-auto-trial-tt')).toBeVisible();
      await expect(page.getByTestId('settings-auth-subscription-auto-trial-amz')).toBeVisible();
      await expect(page.getByTestId('settings-auth-post-login-session')).toHaveCount(0);
      await expect(page.getByTestId('settings-auth-recharge-button')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
