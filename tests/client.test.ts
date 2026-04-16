import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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

describe('ICClient.request — error paths', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  it('throws AuthFailedError when login POST returns 4xx without cookie', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('throws PortalUnreachableError when login POST returns 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 502 }));
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Portal unreachable/);
  });

  it('throws PortalUnreachableError when data GET returns 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Portal unreachable/);
  });

  it('throws on non-ok, non-5xx, non-401 response', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' }));
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/IC 404/);
  });

  it('returns null when response body is empty', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new ICClient(accounts);
    const result = await client.request('anoka', '/x');
    expect(result).toBeNull();
  });

  it('re-logs in after TTL expires (existing session branch)', async () => {
    fetchSpy
      // login 1
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      // request 1 OK
      .mockResolvedValueOnce(new Response(JSON.stringify({ n: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      // login 2 (after TTL expiry)
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=c' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=d' } }))
      // request 2 OK
      .mockResolvedValueOnce(new Response(JSON.stringify({ n: 2 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(accounts);
    await client.request('anoka', '/x');

    // Force expiry: mutate session loggedInAt via Date.now spy
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + sixHoursMs);

    await client.request('anoka', '/x');
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('throws AuthFailedError when neither login step returns a cookie', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200 })) // no cookie
      .mockResolvedValueOnce(new Response('', { status: 200 })); // no cookie
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('throws on download non-ok response', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const client = new ICClient(accounts);
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = await mkdtemp(join(tmpdir(), 'ic-dl-'));
    try {
      await expect(client.download('anoka', '/x', join(dir, 'a.pdf'))).rejects.toThrow(/IC download 404/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('download throws UnknownDistrictError for unknown district', async () => {
    const client = new ICClient(accounts);
    await expect(client.download('nope', '/x', '/tmp/foo.pdf')).rejects.toThrow(/Unknown district/);
  });

  it('download uses octet-stream when no content-type header', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = await mkdtemp(join(tmpdir(), 'ic-dl-'));
    try {
      const client = new ICClient(accounts);
      const meta = await client.download('anoka', '/x', join(dir, 'a.bin'));
      expect(meta.contentType).toBe('application/octet-stream');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parseSetCookie handles empty header via login with no cookies at all', async () => {
    // Covers the `if (!header) return ''` branch in parseSetCookie
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new ICClient(accounts);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });
});

describe('ICClient.download', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ic-test-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('writes response body to destinationPath and returns metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1,2,3,4,5]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }));

    const client = new ICClient(accounts);
    const dest = join(dir, 'report.pdf');
    const meta = await client.download('anoka', '/campus/path/to/doc', dest);

    expect(meta).toEqual({ path: dest, bytes: 5, contentType: 'application/pdf' });
    expect((await readFile(dest)).length).toBe(5);
  });

  it('throws InvalidPath when destination is a directory', async () => {
    const client = new ICClient(accounts);
    await expect(client.download('anoka', '/x', dir)).rejects.toThrow(/InvalidPath|destinationPath/);
  });

  it('throws ParentDirectoryMissing when parent dir does not exist', async () => {
    const client = new ICClient(accounts);
    await expect(client.download('anoka', '/x', join(dir, 'nope', 'x.pdf'))).rejects.toThrow(/ParentDirectoryMissing/);
  });

  it('throws FileExists when file is present and overwrite not set', async () => {
    const dest = join(dir, 'r.pdf');
    await fsWriteFile(dest, 'hi');
    const client = new ICClient(accounts);
    await expect(client.download('anoka', '/x', dest)).rejects.toThrow(/FileExists/);
  });

  it('overwrites when overwrite:true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=a' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9,9,9]), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      }));
    const dest = join(dir, 'r.pdf');
    await fsWriteFile(dest, 'old');
    const client = new ICClient(accounts);
    const meta = await client.download('anoka', '/x', dest, { overwrite: true });
    expect(meta.bytes).toBe(3);
  });
});
