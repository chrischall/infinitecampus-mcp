import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// resolveAuth() drives three paths:
//   1. IC_USERNAME + IC_PASSWORD + IC_BASE_URL + IC_DISTRICT → password login
//      (existing behavior; loadAccount() returns a fully-creds Account).
//   2. IC_BASE_URL + IC_DISTRICT (but no IC_USERNAME/IC_PASSWORD) → fetchproxy
//      fallback. @fetchproxy/bootstrap reads JSESSIONID + XSRF-TOKEN cookies
//      from the user's signed-in IC portal tab. The client gets a synthesized
//      Account with empty creds and pre-loaded session cookies.
//   3. error: tell the user to set creds or sign into the portal.
//
// IC_BASE_URL + IC_DISTRICT are REQUIRED in both modes (the MCP needs to know
// which host to declare and which district to dispatch on). Only username +
// password become optional.

// Mock @fetchproxy/bootstrap at the module boundary — never hit a real WS.
const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

import { resolveAuth } from '../src/auth.js';

const ENV_KEYS = [
  'IC_BASE_URL',
  'IC_DISTRICT',
  'IC_USERNAME',
  'IC_PASSWORD',
  'IC_NAME',
  'IC_DISABLE_FETCHPROXY',
] as const;

describe('resolveAuth', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    bootstrapMock.mockReset();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('path 1: env-var credentials', () => {
    it('returns the full Account when all four IC_* creds are set', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_USERNAME = 'parent@example.com';
      process.env.IC_PASSWORD = 'secret';

      const result = await resolveAuth();

      expect(result.source).toBe('env');
      expect(result.account).toEqual({
        name: 'anoka',
        baseUrl: 'https://anoka.infinitecampus.org',
        district: 'anoka',
        username: 'parent@example.com',
        password: 'secret',
      });
      expect(result.preloaded).toBeUndefined();
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('takes precedence even when fetchproxy is enabled (no bootstrap call)', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_USERNAME = 'u';
      process.env.IC_PASSWORD = 'p';

      await resolveAuth();
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });

  describe('path 2: fetchproxy fallback', () => {
    it('declares the right host + cookies and synthesizes an Account with empty creds', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      bootstrapMock.mockResolvedValue({
        cookies: { JSESSIONID: 'sess-from-fp', 'XSRF-TOKEN': 'xsrf-from-fp' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      const result = await resolveAuth();

      expect(bootstrapMock).toHaveBeenCalledTimes(1);
      const opts = bootstrapMock.mock.calls[0]![0] as {
        serverName: string;
        version: string;
        domains: string[];
        declare: {
          cookies: string[];
          localStorage: string[];
          sessionStorage: string[];
          captureHeaders: unknown[];
        };
      };
      expect(opts.serverName).toBe('infinitecampus-mcp');
      expect(typeof opts.version).toBe('string');
      // Declare just this host (no wildcard) — each IC district is its own root.
      expect(opts.domains).toEqual(['anoka.infinitecampus.org']);
      expect(opts.declare.cookies.sort()).toEqual(['JSESSIONID', 'XSRF-TOKEN']);
      expect(opts.declare.localStorage).toEqual([]);
      expect(opts.declare.sessionStorage).toEqual([]);
      expect(opts.declare.captureHeaders).toEqual([]);

      expect(result.source).toBe('fetchproxy');
      expect(result.account).toEqual({
        name: 'anoka',
        baseUrl: 'https://anoka.infinitecampus.org',
        district: 'anoka',
        username: '',
        password: '',
      });
      expect(result.preloaded?.cookieHeader).toBe('JSESSIONID=sess-from-fp; XSRF-TOKEN=xsrf-from-fp');
      expect(result.preloaded?.xsrfToken).toBe('xsrf-from-fp');
    });

    it('honors IC_NAME for the friendly Account.name', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_NAME = 'Anoka-Hennepin';
      bootstrapMock.mockResolvedValue({
        cookies: { JSESSIONID: 's', 'XSRF-TOKEN': 'x' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      const result = await resolveAuth();
      expect(result.account.name).toBe('Anoka-Hennepin');
    });

    it('extracts the host correctly even when IC_BASE_URL has a path / trailing slash', async () => {
      process.env.IC_BASE_URL = 'https://campus.springfield.k12.example.us/';
      process.env.IC_DISTRICT = 'springfield';
      bootstrapMock.mockResolvedValue({
        cookies: { JSESSIONID: 's', 'XSRF-TOKEN': 'x' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      await resolveAuth();
      const opts = bootstrapMock.mock.calls[0]![0] as { domains: string[] };
      expect(opts.domains).toEqual(['campus.springfield.k12.example.us']);
    });

    it('throws when JSESSIONID is missing from the snapshot', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      bootstrapMock.mockResolvedValue({
        cookies: { 'XSRF-TOKEN': 'x' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      await expect(resolveAuth()).rejects.toThrow(/JSESSIONID/);
      await expect(resolveAuth()).rejects.toThrow(/Sign into your IC portal/i);
    });

    it('throws when XSRF-TOKEN is missing from the snapshot', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      bootstrapMock.mockResolvedValue({
        cookies: { JSESSIONID: 's' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      await expect(resolveAuth()).rejects.toThrow(/XSRF-TOKEN/);
    });

    it('wraps bootstrap() errors with an actionable suffix', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      bootstrapMock.mockRejectedValue(new Error('extension offline'));
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: extension offline/);
    });

    it('handles non-Error rejections from bootstrap()', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      bootstrapMock.mockRejectedValue('plain string failure');
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: plain string failure/);
    });
  });

  describe('path 3: missing IC_BASE_URL or IC_DISTRICT', () => {
    it('throws (does not call fetchproxy) when IC_BASE_URL is missing', async () => {
      process.env.IC_DISTRICT = 'anoka';
      // No IC_BASE_URL set.
      await expect(resolveAuth()).rejects.toThrow(/IC_BASE_URL/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('throws (does not call fetchproxy) when IC_DISTRICT is missing', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      // No IC_DISTRICT set.
      await expect(resolveAuth()).rejects.toThrow(/IC_DISTRICT/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('throws on non-https IC_BASE_URL (loadAccount validation propagates)', async () => {
      process.env.IC_BASE_URL = 'http://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_USERNAME = 'u';
      process.env.IC_PASSWORD = 'p';
      await expect(resolveAuth()).rejects.toThrow(/IC_BASE_URL must be an https URL/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('throws when IC_USERNAME is set but IC_PASSWORD is not (partial creds → user mistake)', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_USERNAME = 'u';
      // IC_PASSWORD not set.
      await expect(resolveAuth()).rejects.toThrow(/IC_PASSWORD/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('throws when IC_PASSWORD is set but IC_USERNAME is not (partial creds → user mistake)', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_PASSWORD = 'p';
      // IC_USERNAME not set.
      await expect(resolveAuth()).rejects.toThrow(/IC_USERNAME/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });

  describe('path 4: fetchproxy explicitly disabled', () => {
    it('skips fetchproxy when IC_DISABLE_FETCHPROXY=1 (missing creds become a hard error)', async () => {
      process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
      process.env.IC_DISTRICT = 'anoka';
      process.env.IC_DISABLE_FETCHPROXY = '1';
      await expect(resolveAuth()).rejects.toThrow(/IC_USERNAME/);
      await expect(resolveAuth()).rejects.toThrow(/IC_PASSWORD/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it.each(['1', 'true', 'yes', 'on', 'TRUE'])(
      'treats IC_DISABLE_FETCHPROXY=%j as disabled',
      async (val) => {
        process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
        process.env.IC_DISTRICT = 'anoka';
        process.env.IC_DISABLE_FETCHPROXY = val;
        await expect(resolveAuth()).rejects.toThrow(/IC_USERNAME/);
        expect(bootstrapMock).not.toHaveBeenCalled();
      },
    );

    it.each(['0', 'false', 'no', '', 'off'])(
      'treats IC_DISABLE_FETCHPROXY=%j as enabled (default)',
      async (val) => {
        process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
        process.env.IC_DISTRICT = 'anoka';
        process.env.IC_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: { JSESSIONID: 's', 'XSRF-TOKEN': 'x' },
          localStorage: {},
          sessionStorage: {},
          capturedHeaders: {},
        });
        await resolveAuth();
        expect(bootstrapMock).toHaveBeenCalled();
      },
    );

    it.each(['undefined', 'null', '${IC_DISABLE_FETCHPROXY}'])(
      'treats IC_DISABLE_FETCHPROXY=%j as unset (= enabled)',
      async (val) => {
        process.env.IC_BASE_URL = 'https://anoka.infinitecampus.org';
        process.env.IC_DISTRICT = 'anoka';
        process.env.IC_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: { JSESSIONID: 's', 'XSRF-TOKEN': 'x' },
          localStorage: {},
          sessionStorage: {},
          capturedHeaders: {},
        });
        await resolveAuth();
        expect(bootstrapMock).toHaveBeenCalled();
      },
    );
  });
});
