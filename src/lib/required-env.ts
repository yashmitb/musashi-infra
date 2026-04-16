export function findMissingEnv(
  requiredNames: string[],
  env: Record<string, string | undefined> = process.env
): string[] {
  return requiredNames.filter((name) => !env[name]);
}

export function formatMissingEnvMessage(missing: string[], context: 'local' | 'ci'): string {
  const suffix =
    context === 'ci'
      ? 'Add them under repository Settings -> Secrets and variables -> Actions -> Repository secrets.'
      : 'Create a .env file in the repo root or set them in your shell.';

  return `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ${suffix}`;
}
