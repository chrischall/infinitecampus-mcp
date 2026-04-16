import { describe, it, expect } from 'vitest';
import { loadAccount } from '../src/config.js';

const baseEnv = {
  IC_BASE_URL: 'https://anoka.infinitecampus.org',
  IC_DISTRICT: 'anoka',
  IC_USERNAME: 'parent@example.com',
  IC_PASSWORD: 'secret',
};

describe('loadAccount', () => {
  it('returns an Account when all required vars are set', () => {
    const account = loadAccount(baseEnv);
    expect(account).toEqual({
      name: 'anoka',
      baseUrl: 'https://anoka.infinitecampus.org',
      district: 'anoka',
      username: 'parent@example.com',
      password: 'secret',
    });
  });

  it('uses IC_NAME as name when provided', () => {
    const env = { ...baseEnv, IC_NAME: 'Springfield' };
    expect(loadAccount(env).name).toBe('Springfield');
  });

  it('defaults name to IC_DISTRICT when IC_NAME is not set', () => {
    expect(loadAccount(baseEnv).name).toBe('anoka');
  });

  it('strips trailing slash from BASE_URL', () => {
    const env = { ...baseEnv, IC_BASE_URL: 'https://anoka.infinitecampus.org/' };
    expect(loadAccount(env).baseUrl).toBe('https://anoka.infinitecampus.org');
  });
});

describe('loadAccount errors', () => {
  it('throws when IC_BASE_URL is missing', () => {
    const { IC_BASE_URL: _, ...env } = baseEnv;
    expect(() => loadAccount(env)).toThrow(/Missing required.*IC_BASE_URL/);
  });

  it('throws when IC_PASSWORD is missing', () => {
    const { IC_PASSWORD: _, ...env } = baseEnv;
    expect(() => loadAccount(env)).toThrow(/Missing required.*IC_PASSWORD/);
  });

  it('throws when all required vars are missing', () => {
    expect(() => loadAccount({})).toThrow(/Missing required/);
  });

  it('throws on non-https BASE_URL', () => {
    const env = { ...baseEnv, IC_BASE_URL: 'http://anoka.infinitecampus.org' };
    expect(() => loadAccount(env)).toThrow(/IC_BASE_URL must be an https URL/);
  });
});
