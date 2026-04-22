/**
 * SparkBoost API Key Management
 *
 * Manages SparkBoost API keys encrypted at rest via Electron safeStorage.
 * Keys are decrypted at runtime and injected as environment variables
 * for the OpenClaw Gateway process. Never written plaintext to config files.
 */
import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from '../../utils/paths';
import * as logger from '../../utils/logger';

const ENCRYPTED_KEYS_FILE = 'sparkboost-keys.enc';
const ENV_SECRET_KEY = 'SPARKBOOST_SECRET_KEY';
const ENV_API_KEY = 'SPARKBOOST_API_KEY';

function getKeysFilePath(): string {
  return join(getOpenClawConfigDir(), ENCRYPTED_KEYS_FILE);
}

interface SparkBoostKeys {
  secretKey: string;
  apiKey: string;
}

/**
 * Check if safeStorage is available on this platform.
 */
export function isSafeStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Store SparkBoost keys encrypted on disk.
 */
export async function storeEncryptedKeys(keys: SparkBoostKeys): Promise<void> {
  if (!isSafeStorageAvailable()) {
    throw new Error('safeStorage is not available — cannot encrypt SparkBoost keys');
  }

  const payload = JSON.stringify(keys);
  const encrypted = safeStorage.encryptString(payload);

  const dir = getOpenClawConfigDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(getKeysFilePath(), encrypted);
  logger.info('SparkBoost keys encrypted and stored');
}

/**
 * Read and decrypt SparkBoost keys from disk.
 * Returns null if keys don't exist or decryption fails.
 */
export async function readEncryptedKeys(): Promise<SparkBoostKeys | null> {
  const filePath = getKeysFilePath();
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    if (!isSafeStorageAvailable()) {
      logger.warn('safeStorage unavailable — cannot decrypt SparkBoost keys');
      return null;
    }

    const encrypted = await readFile(filePath);
    const decrypted = safeStorage.decryptString(encrypted as any);
    return JSON.parse(decrypted) as SparkBoostKeys;
  } catch (err) {
    logger.error('Failed to decrypt SparkBoost keys:', err);
    return null;
  }
}

/**
 * Inject SparkBoost keys into the current process environment.
 * This makes them available to the Gateway child process via inherit.
 *
 * Returns true if keys were injected, false if no keys available.
 */
export async function injectSparkBoostKeys(): Promise<boolean> {
  const keys = await readEncryptedKeys();
  if (!keys) {
    // Fall back to env vars already set (e.g., from .env during development)
    if (process.env[ENV_SECRET_KEY] && process.env[ENV_API_KEY]) {
      logger.info('SparkBoost keys loaded from environment');
      return true;
    }
    logger.warn('No SparkBoost keys available — plugin will not function');
    return false;
  }

  process.env[ENV_SECRET_KEY] = keys.secretKey;
  process.env[ENV_API_KEY] = keys.apiKey;
  logger.info('SparkBoost keys injected from encrypted storage');
  return true;
}

/**
 * Initialize SparkBoost keys on first launch.
 * If encrypted keys don't exist, reads from environment (set by build pipeline)
 * and stores them encrypted.
 */
export async function initializeSparkBoostKeys(): Promise<void> {
  const existing = await readEncryptedKeys();
  if (existing) {
    return;
  }

  // Read from env vars (injected by build pipeline or .env)
  const secretKey = process.env.SPARKBOOST_SECRET_KEY;
  const apiKey = process.env.SPARKBOOST_API_KEY;

  if (!secretKey || !apiKey) {
    logger.info('No SparkBoost keys to initialize — plugin requires manual configuration');
    return;
  }

  if (!isSafeStorageAvailable()) {
    logger.warn('safeStorage unavailable — cannot store SparkBoost keys encrypted');
    return;
  }

  await storeEncryptedKeys({ secretKey, apiKey });
  logger.info('SparkBoost keys initialized and encrypted');
}
