import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sessionCachePath,
  createSessionCache,
  reportCacheWriteFailure,
} from '../src/session-cache.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ic-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = (over: Record<string, unknown> = {}) => ({
  env: { MCP_DATA_DIR: dir, IC_SESSION_CACHE: 'true' } as NodeJS.ProcessEnv,
  district: 'Springfield',
  baseUrl: 'https://ic.springfield.edu',
  username: 'parent@example.com',
  password: 'pw1',
  ...over,
});

const record = (over: Partial<{ cookieHeader: string; xsrfToken: string }> = {}) => ({
  session: { cookieHeader: 'JSESSIONID=abc', xsrfToken: 'x1', ...over },
  sessionAt: Date.now(),
});

const cacheFile = (d: string, district = 'springfield'): string =>
  join(d, '.infinitecampus-mcp', `session-${district}.json`);

describe('sessionCachePath', () => {
  it('prefers MCP_DATA_DIR, the variable mcp-host injects', () => {
    expect(sessionCachePath({ MCP_DATA_DIR: '/data' }, 'Springfield')).toBe(
      '/data/.infinitecampus-mcp/session-springfield.json',
    );
  });

  it('honours an explicit IC_SESSION_FILE', () => {
    expect(sessionCachePath({ IC_SESSION_FILE: '/tmp/x.json', MCP_DATA_DIR: '/data' }, 'd')).toBe(
      '/tmp/x.json',
    );
  });

  it('ignores a sentinel override rather than making a relative ./null', () => {
    expect(sessionCachePath({ IC_SESSION_FILE: 'null', HOME: '/home/u' }, 'd')).toBe(
      '/home/u/.infinitecampus-mcp/session-d.json',
    );
  });

  it('falls back to a plain name when there is no district', () => {
    expect(sessionCachePath({ MCP_DATA_DIR: '/data' })).toBe(
      '/data/.infinitecampus-mcp/session.json',
    );
  });
});

describe('createSessionCache', () => {
  it('round-trips a session through a 0600 file', () => {
    createSessionCache(base())!.save(record());
    expect(statSync(cacheFile(dir)).mode & 0o777).toBe(0o600);
    const back = createSessionCache(base())!.load();
    expect(back?.session.cookieHeader).toBe('JSESSIONID=abc');
    expect(back?.session.xsrfToken).toBe('x1');
  });

  it('keeps two districts apart instead of clobbering', () => {
    // A deployment can point at more than one IC instance; one shared file would
    // have each save overwrite the other and neither ever get a hit.
    const a = createSessionCache(base({ district: 'Springfield' }))!;
    const b = createSessionCache(
      base({ district: 'Shelbyville', baseUrl: 'https://ic.shelbyville.edu' }),
    )!;
    a.save(record({ cookieHeader: 'JSESSIONID=aaa' }));
    b.save(record({ cookieHeader: 'JSESSIONID=bbb' }));
    expect(a.load()?.session.cookieHeader).toBe('JSESSIONID=aaa');
    expect(b.load()?.session.cookieHeader).toBe('JSESSIONID=bbb');
  });

  it.each([
    ['a rotated password', base({ password: 'pw2' })],
    ['a different account', base({ username: 'other@example.com' })],
    ['a different IC instance', base({ baseUrl: 'https://ic.other.edu' })],
  ])('discards the cache on %s', (_label, opts) => {
    createSessionCache(base())!.save(record());
    expect(createSessionCache(opts)!.load()).toBeNull();
  });

  it('matches the username case-insensitively', () => {
    createSessionCache(base())!.save(record());
    expect(createSessionCache(base({ username: '  Parent@Example.COM ' }))!.load()).not.toBeNull();
  });

  it('caches in fetchproxy mode, where credentials are empty by design', () => {
    // Worth caching MORE there, not less: this mode cannot re-login unaided, so
    // a cached session is what lets a cold start proceed with no browser.
    const p = createSessionCache(
      base({ username: null, password: null, browserBacked: true }),
    );
    expect(p).not.toBeNull();
    p!.save(record());
    expect(
      createSessionCache(base({ username: null, password: null, browserBacked: true }))!.load(),
    ).not.toBeNull();
  });

  it('does not reuse a password-minted session in fetchproxy mode', () => {
    createSessionCache(base())!.save(record());
    expect(
      createSessionCache(base({ username: null, password: null, browserBacked: true }))!.load(),
    ).toBeNull();
  });

  it.each([
    ['IC_SESSION_CACHE=false', base({ env: { MCP_DATA_DIR: dir, IC_SESSION_CACHE: 'false' } })],
    ['no credentials and no bridge', base({ username: null, password: null })],
  ])('is disabled for %s', (_label, opts) => {
    expect(createSessionCache(opts)).toBeNull();
  });

  it('writes no credential material to disk', () => {
    createSessionCache(base())!.save(record());
    const body = readFileSync(cacheFile(dir), 'utf8');
    expect(body).not.toContain('pw1');
    expect(body).not.toContain('parent@example.com');
  });
});

describe('stored-record shape guard', () => {
  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['a missing sessionAt', { session: { cookieHeader: 'a=1', xsrfToken: 'x' } }],
    ['a primitive session', { session: 'nope', sessionAt: 1 }],
    ['a missing cookieHeader', { session: { xsrfToken: 'x' }, sessionAt: 1 }],
    ['an EMPTY cookieHeader', { session: { cookieHeader: '', xsrfToken: 'x' }, sessionAt: 1 }],
    ['a missing xsrfToken', { session: { cookieHeader: 'a=1' }, sessionAt: 1 }],
  ])('rejects %s rather than restoring an unusable session', (_label, body) => {
    // The missing-xsrfToken case matters as much as the cookie: a session
    // without it reads as authenticated and then fails every write that needs
    // the X-XSRF-TOKEN header.
    const p = createSessionCache(base())!;
    p.save(record());
    // Swap only the STATE, keeping the envelope's salted binding intact —
    // overwriting the whole file would be rejected by the binding check before
    // the shape guard ever ran, which is the wrong reason to pass.
    const envelope = JSON.parse(readFileSync(cacheFile(dir), 'utf8')) as { state: unknown };
    envelope.state = body;
    writeFileSync(cacheFile(dir), JSON.stringify(envelope), { mode: 0o600 });
    expect(createSessionCache(base())!.load()).toBeNull();
  });
});

describe('reportCacheWriteFailure', () => {
  it.each([
    ['an Error', new Error('EROFS'), 'EROFS'],
    ['a non-Error', 'disk gone', 'disk gone'],
  ])('names the cause for %s and stays on stderr', (_label, thrown, expected) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reportCacheWriteFailure(thrown);
      expect(err).toHaveBeenCalledWith(expect.stringContaining(expected as string));
      expect(out).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });
});

describe('cache disabled writes nothing', () => {
  it('creates no directory at all', () => {
    expect(
      createSessionCache(base({ env: { MCP_DATA_DIR: dir, IC_SESSION_CACHE: 'false' } })),
    ).toBeNull();
    expect(existsSync(join(dir, '.infinitecampus-mcp'))).toBe(false);
  });
});
