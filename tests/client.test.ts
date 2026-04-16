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
