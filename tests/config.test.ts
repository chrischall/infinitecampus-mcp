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

  it('throws when only IC_PASSWORD is missing (partial creds = user mistake)', () => {
    const { IC_PASSWORD: _, ...env } = baseEnv;
    expect(() => loadAccount(env)).toThrow(/IC_PASSWORD/);
    expect(() => loadAccount(env)).toThrow(/Set both IC_USERNAME and IC_PASSWORD/);
  });

  it('throws when only IC_USERNAME is missing (partial creds = user mistake)', () => {
    const { IC_USERNAME: _, ...env } = baseEnv;
    expect(() => loadAccount(env)).toThrow(/IC_USERNAME/);
  });

  it('throws when IC_BASE_URL + IC_DISTRICT are both missing', () => {
    expect(() => loadAccount({})).toThrow(/Missing required.*IC_BASE_URL.*IC_DISTRICT/);
  });

  it('throws on non-https BASE_URL', () => {
    const env = { ...baseEnv, IC_BASE_URL: 'http://anoka.infinitecampus.org' };
    expect(() => loadAccount(env)).toThrow(/IC_BASE_URL must be an https URL/);
  });

  it('returns empty username/password when neither is set (fetchproxy fallback signal)', () => {
    const env = {
      IC_BASE_URL: 'https://anoka.infinitecampus.org',
      IC_DISTRICT: 'anoka',
    };
    const account = loadAccount(env);
    expect(account.username).toBe('');
    expect(account.password).toBe('');
  });
});

describe('loadAccount — env-var sanitization (readVar)', () => {
  // readVar's defenses against MCP hosts that pass unexpanded `${VAR}`
  // placeholders, or stringified `undefined`/`null` values.
  it.each([
    ['undefined', 'IC_BASE_URL'],
    ['null', 'IC_BASE_URL'],
    ['${IC_BASE_URL}', 'IC_BASE_URL'],
    ['   ', 'IC_BASE_URL'],
  ])('treats IC_BASE_URL=%j as unset', (value, key) => {
    const env = { ...baseEnv, [key]: value };
    expect(() => loadAccount(env)).toThrow(/IC_BASE_URL/);
  });

  it('coerces non-string env values to undefined (raw not a string branch)', () => {
    // Simulates an environment where the host injects a non-string value
    // (defensive: the Node typings allow undefined, but a misbehaving host
    // could pass numbers/booleans). readVar should treat as unset.
    const env = { ...baseEnv, IC_NAME: undefined } as Record<string, string | undefined>;
    expect(loadAccount(env).name).toBe(baseEnv.IC_DISTRICT);
  });
});
