import { describe, expect, it } from 'vitest';

import { findMissingEnv, formatMissingEnvMessage } from '../../src/lib/required-env.js';

describe('required env helpers', () => {
  it('returns only missing variables', () => {
    expect(findMissingEnv(['A', 'B', 'C'], { A: '1', B: '', C: '3' })).toEqual(['B']);
  });

  it('formats a local setup message', () => {
    expect(formatMissingEnvMessage(['SUPABASE_URL'], 'local')).toContain('Create a .env file');
  });

  it('formats a ci setup message', () => {
    expect(formatMissingEnvMessage(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'], 'ci')).toContain('Repository secrets');
  });
});
