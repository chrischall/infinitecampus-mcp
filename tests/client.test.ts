import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ICClient } from '../src/client.js';
import type { Account } from '../src/config.js';

const accounts: Account[] = [
  { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka',
    username: 'u', password: 'p' },
  { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org', district: 'mpls',
    username: 'u', password: 'p' },
];

describe('ICClient.listDistricts', () => {
  it('returns name + baseUrl for each configured account, no creds', () => {
    const client = new ICClient(accounts);
    expect(client.listDistricts()).toEqual([
      { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org' },
      { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org' },
    ]);
  });
});

describe('ICClient.request — login + GET', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => vi.restoreAllMocks());

  function mockLoginThenGet(jsonData: unknown) {
    // 1st call: GET login form → 200 with Set-Cookie: JSESSIONID=...
    // 2nd call: POST login → 200 with Set-Cookie
    // 3rd call: GET data → 200 JSON
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/; HttpOnly' },
      }))
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=session-after-login; Path=/' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(jsonData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
  }

  it('logs in lazily on first request, reuses cookie on second', async () => {
    const client = new ICClient(accounts);
    mockLoginThenGet({ ok: true });

    const result = await client.request<{ ok: boolean }>('anoka', '/campus/api/portal/parents/students');

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3); // GET login, POST login, GET data

    // 2nd request: only one new fetch (data only, login reused)
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await client.request('anoka', '/campus/api/portal/parents/students');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('throws UnknownDistrictError when district not configured', async () => {
    const client = new ICClient(accounts);
    await expect(client.request('nope', '/x')).rejects.toThrow(/Unknown district 'nope'/);
  });
});

describe('ICClient.request — retry + concurrency', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  it('re-logs in once on 401 and retries', async () => {
    fetchSpy
      // First login
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=a; Path=/' } }))
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=b; Path=/' } }))
      // GET returns 401
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // Re-login
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=c; Path=/' } }))
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=d; Path=/' } }))
      // Retry succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(accounts);
    const result = await client.request('anoka', '/x');
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('throws SessionExpiredError on second 401', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=c' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=d' } }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Session expired/);
  });

  it('shares a single in-flight login across concurrent requests to same district', async () => {
    let loginCount = 0;
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/portal/parents/')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } });
      }
      if (u.includes('/campus/verify.jsp')) {
        loginCount++;
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } });
      }
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    const client = new ICClient(accounts);
    await Promise.all([
      client.request('anoka', '/x'),
      client.request('anoka', '/y'),
      client.request('anoka', '/z'),
    ]);
    expect(loginCount).toBe(1);
  });

  it('logs in independently for each district', async () => {
    let loginCount = 0;
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/verify.jsp')) loginCount++;
      if (u.endsWith('.jsp') || u.includes('/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=x' } });
      }
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    const client = new ICClient(accounts);
    await Promise.all([
      client.request('anoka', '/x'),
      client.request('mpls', '/y'),
    ]);
    expect(loginCount).toBe(2);
  });
});
