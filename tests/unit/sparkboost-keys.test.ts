import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock Electron safeStorage
const mockEncrypt = vi.fn((input: string) => Buffer.from(`enc:${input}`));
const mockDecrypt = vi.fn((input: Buffer) => {
  const str = input.toString();
  return str.replace(/^enc:/, '');
});
const mockIsAvailable = vi.fn(() => true);

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: mockEncrypt,
    decryptString: mockDecrypt,
    isEncryptionAvailable: mockIsAvailable,
  },
}));

// Mock paths
let testDir: string;

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testDir,
}));

describe('sparkboost-keys', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'sparkboost-keys-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('storeEncryptedKeys / readEncryptedKeys', () => {
    it('round-trips keys through encryption', async () => {
      const { storeEncryptedKeys, readEncryptedKeys } =
        await import('@electron/services/secrets/sparkboost-keys');

      await storeEncryptedKeys({
        secretKey: 'secret-123',
        apiKey: 'api-456',
      });

      expect(mockEncrypt).toHaveBeenCalledWith(
        JSON.stringify({ secretKey: 'secret-123', apiKey: 'api-456' })
      );
      expect(existsSync(join(testDir, 'sparkboost-keys.enc'))).toBe(true);

      mockDecrypt.mockReturnValueOnce(
        JSON.stringify({ secretKey: 'secret-123', apiKey: 'api-456' })
      );
      const keys = await readEncryptedKeys();
      expect(keys).toEqual({ secretKey: 'secret-123', apiKey: 'api-456' });
    });

    it('returns null when no keys file exists', async () => {
      const { readEncryptedKeys } = await import('@electron/services/secrets/sparkboost-keys');
      const keys = await readEncryptedKeys();
      expect(keys).toBeNull();
    });

    it('returns null when decryption fails', async () => {
      const { storeEncryptedKeys, readEncryptedKeys } =
        await import('@electron/services/secrets/sparkboost-keys');
      await storeEncryptedKeys({ secretKey: 's', apiKey: 'a' });

      mockDecrypt.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });
      const keys = await readEncryptedKeys();
      expect(keys).toBeNull();
    });
  });

  describe('injectSparkBoostKeys', () => {
    it('injects decrypted keys into process.env', async () => {
      const { storeEncryptedKeys, injectSparkBoostKeys } =
        await import('@electron/services/secrets/sparkboost-keys');
      await storeEncryptedKeys({ secretKey: 's1', apiKey: 'a1' });

      mockDecrypt.mockReturnValueOnce(JSON.stringify({ secretKey: 's1', apiKey: 'a1' }));
      const result = await injectSparkBoostKeys();
      expect(result).toBe(true);
      expect(process.env.SPARKBOOST_SECRET_KEY).toBe('s1');
      expect(process.env.SPARKBOOST_API_KEY).toBe('a1');
    });

    it('falls back to env vars when no encrypted keys', async () => {
      const { injectSparkBoostKeys } = await import('@electron/services/secrets/sparkboost-keys');
      process.env.SPARKBOOST_SECRET_KEY = 'env-secret';
      process.env.SPARKBOOST_API_KEY = 'env-api';

      const result = await injectSparkBoostKeys();
      expect(result).toBe(true);

      delete process.env.SPARKBOOST_SECRET_KEY;
      delete process.env.SPARKBOOST_API_KEY;
    });

    it('returns false when no keys available at all', async () => {
      const { injectSparkBoostKeys } = await import('@electron/services/secrets/sparkboost-keys');
      delete process.env.SPARKBOOST_SECRET_KEY;
      delete process.env.SPARKBOOST_API_KEY;

      const result = await injectSparkBoostKeys();
      expect(result).toBe(false);
    });
  });

  describe('initializeSparkBoostKeys', () => {
    it('stores keys from env on first launch', async () => {
      const { initializeSparkBoostKeys, readEncryptedKeys } =
        await import('@electron/services/secrets/sparkboost-keys');
      process.env.SPARKBOOST_SECRET_KEY = 'init-secret';
      process.env.SPARKBOOST_API_KEY = 'init-api';

      await initializeSparkBoostKeys();

      mockDecrypt.mockReturnValueOnce(
        JSON.stringify({ secretKey: 'init-secret', apiKey: 'init-api' })
      );
      const keys = await readEncryptedKeys();
      expect(keys).toEqual({ secretKey: 'init-secret', apiKey: 'init-api' });

      delete process.env.SPARKBOOST_SECRET_KEY;
      delete process.env.SPARKBOOST_API_KEY;
    });

    it('skips when keys already exist', async () => {
      const { storeEncryptedKeys, initializeSparkBoostKeys } =
        await import('@electron/services/secrets/sparkboost-keys');
      await storeEncryptedKeys({ secretKey: 'existing', apiKey: 'existing' });
      mockEncrypt.mockClear();

      await initializeSparkBoostKeys();
      expect(mockEncrypt).not.toHaveBeenCalled();
    });
  });

  describe('isSafeStorageAvailable', () => {
    it('delegates to safeStorage', async () => {
      const { isSafeStorageAvailable } = await import('@electron/services/secrets/sparkboost-keys');
      mockIsAvailable.mockReturnValueOnce(true);
      expect(isSafeStorageAvailable()).toBe(true);
      mockIsAvailable.mockReturnValueOnce(false);
      expect(isSafeStorageAvailable()).toBe(false);
    });
  });
});
