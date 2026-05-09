import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import * as logger from '../../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerStore: any = null;

function getProviderStorePath(): string {
  return join(app.getPath('userData'), 'BoostClaw-providers.json');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProviderStore(Store: any): any {
  return new Store({
    name: 'BoostClaw-providers',
    defaults: {
      schemaVersion: 0,
      providers: {} as Record<string, unknown>,
      providerAccounts: {} as Record<string, unknown>,
      apiKeys: {} as Record<string, string>,
      providerSecrets: {} as Record<string, unknown>,
      defaultProvider: null as string | null,
      defaultProviderAccountId: null as string | null,
    },
  });
}

function resetCorruptedStore(): void {
  const filePath = getProviderStorePath();
  if (existsSync(filePath)) {
    logger.warn(
      `[provider-store] Removing corrupted store file: ${filePath}`
    );
    try {
      unlinkSync(filePath);
    } catch (unlinkErr) {
      logger.error(
        `[provider-store] Failed to remove corrupted store file:`,
        unlinkErr
      );
    }
  }
}

export async function getBoostClawProviderStore() {
  if (!providerStore) {
    const Store = (await import('electron-store')).default;
    try {
      providerStore = createProviderStore(Store);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        logger.error(
          `[provider-store] Store file is corrupted or encrypted with a different key, resetting to defaults:`,
          err
        );
        providerStore = null;
        resetCorruptedStore();
        providerStore = createProviderStore(Store);
      } else {
        throw err;
      }
    }
  }

  return providerStore;
}
