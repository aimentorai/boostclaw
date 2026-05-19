import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;
    if (process.env[key] != null && process.env[key] !== '') continue;

    const value = stripWrappingQuotes(line.slice(eq + 1));
    process.env[key] = value;
  }
}

const envPath = join(process.cwd(), '.env');
loadEnvFile(envPath);

