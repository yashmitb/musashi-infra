import { loadRuntimeEnv } from './runtime-env.js';
import { findMissingEnv, formatMissingEnvMessage } from './required-env.js';

export async function bootstrapScriptEnv(
  requiredNames: string[],
  options?: {
    envFileUrl?: URL;
  }
): Promise<void> {
  const envFileUrl = options?.envFileUrl ?? new URL('../../.env', import.meta.url);
  const runtimeEnv = await loadRuntimeEnv(envFileUrl);

  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const missing = findMissingEnv(requiredNames);

  if (missing.length > 0) {
    throw new Error(formatMissingEnvMessage(missing, 'local'));
  }
}
