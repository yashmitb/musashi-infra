import { readFile } from 'node:fs/promises';

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export async function loadRuntimeEnv(envFileUrl: URL): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};

  try {
    const rawEnv = await readFile(envFileUrl, 'utf8');
    Object.assign(merged, parseEnv(rawEnv));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }

  return merged;
}
