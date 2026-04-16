import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ICClient } from '../src/client.js';
import type { Account } from '../src/config.js';

const primaryAccount: Account = {
  name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka',
  username: 'u', password: 'p',
};
const mplsAccount: Account = {
  name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org', district: 'mpls',
  username: 'u', password: 'p',
};

/** Mock response for the CUPS linkedAccounts call that returns no linked accounts. */
function noLinkedAccounts() {
  return new Response(JSON.stringify({ accounts: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ICClient.listDistricts', () => {
  it('returns name + baseUrl + linked for the configured account, no creds', () => {
    const client = new ICClient(primaryAccount);
    expect(client.listDistricts()).toEqual([
      { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', linked: false },
    ]);
  });
});

describe('ICClient.ensureDiscovery', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  it('triggers login for the primary account', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=disc; Path=/' },
      }))
      .mockResolvedValueOnce(noLinkedAccounts());

    const client = new ICClient(primaryAccount);
    await client.ensureDiscovery();

    // Should have called fetch twice: login POST + CUPS linkedAccounts
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/campus/verify.jsp');
  });

  it('is a no-op when session is already active', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=disc; Path=/' },
      }))
      .mockResolvedValueOnce(noLinkedAccounts());

    const client = new ICClient(primaryAccount);
    await client.ensureDiscovery();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second call should be a no-op (session still valid)
    await client.ensureDiscovery();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ICClient.request — login + GET', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => vi.restoreAllMocks());

  function mockLoginThenGet(jsonData: unknown) {
    // 1st call: POST login → 200 with Set-Cookie
    // 2nd call: CUPS linkedAccounts → 200 empty
    // 3rd call: GET data → 200 JSON
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=session-after-login; Path=/' },
      }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(JSON.stringify(jsonData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
  }

  it('logs in lazily on first request, reuses cookie on second', async () => {
    const client = new ICClient(primaryAccount);
    mockLoginThenGet({ ok: true });

    const result = await client.request<{ ok: boolean }>('anoka', '/campus/api/portal/parents/students');

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3); // POST login, CUPS linkedAccounts, GET data

    // 2nd request: only one new fetch (data only, login reused)
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await client.request('anoka', '/campus/api/portal/parents/students');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('throws UnknownDistrictError when district not configured', async () => {
    const client = new ICClient(primaryAccount);
    await expect(client.request('nope', '/x')).rejects.toThrow(/Unknown district 'nope'/);
  });
});

describe('ICClient.request — retry + concurrency', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  it('re-logs in once on 401 and retries', async () => {
    fetchSpy
      // First login (POST only)
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=b; Path=/' } }))
      // CUPS linkedAccounts
      .mockResolvedValueOnce(noLinkedAccounts())
      // GET returns 401
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // Re-login (POST only)
      .mockResolvedValueOnce(new Response('', { status: 200,
        headers: { 'set-cookie': 'JSESSIONID=d; Path=/' } }))
      // CUPS linkedAccounts (re-login)
      .mockResolvedValueOnce(noLinkedAccounts())
      // Retry succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(primaryAccount);
    const result = await client.request('anoka', '/x');
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('throws SessionExpiredError on second 401', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=d' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Session expired/);
  });

  it('shares a single in-flight login across concurrent requests to same district', async () => {
    let loginCount = 0;
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        loginCount++;
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    const client = new ICClient(primaryAccount);
    await Promise.all([
      client.request('anoka', '/x'),
      client.request('anoka', '/y'),
      client.request('anoka', '/z'),
    ]);
    expect(loginCount).toBe(1);
  });

});

describe('ICClient.request — error paths', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  it('throws AuthFailedError when login POST returns 4xx without cookie', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('throws AuthFailedError when login POST returns 200 with password-error', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('<div class="password-error">Invalid credentials</div>', { status: 200 }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('throws PortalUnreachableError when login POST returns 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 502 }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Portal unreachable/);
  });

  it('throws PortalUnreachableError when data GET returns 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Portal unreachable/);
  });

  it('throws on non-ok, non-5xx, non-401 response', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/IC 404/);
  });

  it('returns null when response body is empty', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new ICClient(primaryAccount);
    const result = await client.request('anoka', '/x');
    expect(result).toBeNull();
  });

  it('returns raw text (no JSON parsing) when responseType=text', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('<html><title>Hi</title></html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      }));
    const client = new ICClient(primaryAccount);
    const result = await client.request<string>('anoka', '/campus/messageView.xsl', { responseType: 'text' });
    expect(result).toBe('<html><title>Hi</title></html>');
    // Verify Accept header was text-flavored
    const dataCall = fetchSpy.mock.calls[2];
    const headers = (dataCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toContain('text/html');
  });

  it('returns empty string when responseType=text and body is empty', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new ICClient(primaryAccount);
    const result = await client.request<string>('anoka', '/campus/empty', { responseType: 'text' });
    expect(result).toBe('');
  });

  it('re-logs in after TTL expires (existing session branch)', async () => {
    fetchSpy
      // login 1 (POST only)
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      // CUPS linkedAccounts
      .mockResolvedValueOnce(noLinkedAccounts())
      // request 1 OK
      .mockResolvedValueOnce(new Response(JSON.stringify({ n: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      // login 2 (after TTL expiry, POST only)
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=d' } }))
      // CUPS linkedAccounts (re-login)
      .mockResolvedValueOnce(noLinkedAccounts())
      // request 2 OK
      .mockResolvedValueOnce(new Response(JSON.stringify({ n: 2 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/x');

    // Force expiry: mutate session loggedInAt via Date.now spy
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + sixHoursMs);

    await client.request('anoka', '/x');
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('throws AuthFailedError when login POST returns no cookie', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200 })); // no cookie
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('throws on download non-ok response', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const client = new ICClient(primaryAccount);
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
    const client = new ICClient(primaryAccount);
    await expect(client.download('nope', '/x', '/tmp/foo.pdf')).rejects.toThrow(/Unknown district/);
  });

  it('download uses octet-stream when no content-type header', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = await mkdtemp(join(tmpdir(), 'ic-dl-'));
    try {
      const client = new ICClient(primaryAccount);
      const meta = await client.download('anoka', '/x', join(dir, 'a.bin'));
      expect(meta.contentType).toBe('application/octet-stream');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parseSetCookies handles empty header via login with no cookies at all', async () => {
    // Covers the no-cookie branch in parseSetCookies
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new ICClient(primaryAccount);
    await expect(client.request('anoka', '/x')).rejects.toThrow(/Login failed/);
  });

  it('omits X-XSRF-TOKEN header when login returns no XSRF-TOKEN cookie', async () => {
    // Covers the false branch of the xsrfToken ternary on lines 102 and 125.
    // Login sets JSESSIONID but no XSRF-TOKEN → xsrfToken stays ''.
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/' },
      }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');

    // Verify the data request (3rd fetch call) does NOT have X-XSRF-TOKEN
    const dataCall = fetchSpy.mock.calls[2];
    const dataHeaders = (dataCall[1] as RequestInit).headers as Record<string, string>;
    expect(dataHeaders).not.toHaveProperty('X-XSRF-TOKEN');
  });

  it('omits X-XSRF-TOKEN header on download when login returns no XSRF-TOKEN cookie', async () => {
    // Covers the false branch of the xsrfToken ternary on line 102 (download path).
    fetchSpy
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/' },
      }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      }));

    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'ic-xsrf-'));
    try {
      const client = new ICClient(primaryAccount);
      await client.download('anoka', '/campus/doc', join(tmpDir, 'test.pdf'));

      // Verify the download request (3rd fetch call) does NOT have X-XSRF-TOKEN
      const dlCall = fetchSpy.mock.calls[2];
      const dlHeaders = (dlCall[1] as RequestInit).headers as Record<string, string>;
      expect(dlHeaders).not.toHaveProperty('X-XSRF-TOKEN');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('parseSetCookies filters Max-Age=0, malformed, empty-value cookies and extracts XSRF-TOKEN', async () => {
    // Covers lines 164, 168, 174, 177 in parseSetCookies.
    // Use the fallback path (getSetCookie = undefined) with a comma-separated
    // set-cookie header containing all the edge cases.
    const cookieHeader = [
      'deleted=old; Path=/; Max-Age=0',   // Max-Age=0 → filtered (line 164)
      '=noname; Path=/',                   // eqIdx=0 → malformed (line 168)
      'emptyval=; Path=/',                 // empty value → filtered (line 174)
      'JSESSIONID=sess123; Path=/',        // normal cookie kept
      'XSRF-TOKEN=xsrf-abc; Path=/',      // XSRF extraction (line 177)
    ].join(', ');

    const loginRes = new Response('', {
      status: 200,
      headers: { 'set-cookie': cookieHeader },
    });
    // Force the fallback path so comma-splitting is used
    (loginRes.headers as any).getSetCookie = undefined;

    fetchSpy
      .mockResolvedValueOnce(loginRes)
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    const client = new ICClient(primaryAccount);
    const result = await client.request('anoka', '/campus/api/test');
    expect(result).toEqual({ ok: true });

    // Verify the data request includes X-XSRF-TOKEN (proving extraction worked)
    const dataCall = fetchSpy.mock.calls[2];
    const dataHeaders = (dataCall[1] as RequestInit).headers as Record<string, string>;
    expect(dataHeaders['X-XSRF-TOKEN']).toBe('xsrf-abc');

    // Verify the Cookie header has JSESSIONID and XSRF-TOKEN but NOT deleted/emptyval
    expect(dataHeaders['Cookie']).toContain('JSESSIONID=sess123');
    expect(dataHeaders['Cookie']).toContain('XSRF-TOKEN=xsrf-abc');
    expect(dataHeaders['Cookie']).not.toContain('deleted');
    expect(dataHeaders['Cookie']).not.toContain('emptyval');
  });

  it('parseSetCookies falls back to get("set-cookie") when getSetCookie is unavailable', async () => {
    // Covers the fallback branch in parseSetCookies when getSetCookie
    // is not present on the headers object (optional chaining + comma fallback).
    const loginRes = new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=fallback; Path=/' } });
    // Delete getSetCookie entirely so optional chaining evaluates to undefined
    (loginRes.headers as any).getSetCookie = undefined;
    fetchSpy
      .mockResolvedValueOnce(loginRes)
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const client = new ICClient(primaryAccount);
    const result = await client.request('anoka', '/x');
    expect(result).toEqual({ ok: true });
  });
});

describe('ICClient.download', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ic-test-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('writes response body to destinationPath and returns metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(new Uint8Array([1,2,3,4,5]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }));

    const client = new ICClient(primaryAccount);
    const dest = join(dir, 'report.pdf');
    const meta = await client.download('anoka', '/campus/path/to/doc', dest);

    expect(meta).toEqual({ path: dest, bytes: 5, contentType: 'application/pdf' });
    expect((await readFile(dest)).length).toBe(5);
  });

  it('throws InvalidPath when destination is a directory', async () => {
    const client = new ICClient(primaryAccount);
    await expect(client.download('anoka', '/x', dir)).rejects.toThrow(/InvalidPath|destinationPath/);
  });

  it('throws ParentDirectoryMissing when parent dir does not exist', async () => {
    const client = new ICClient(primaryAccount);
    await expect(client.download('anoka', '/x', join(dir, 'nope', 'x.pdf'))).rejects.toThrow(/ParentDirectoryMissing/);
  });

  it('throws FileExists when file is present and overwrite not set', async () => {
    const dest = join(dir, 'r.pdf');
    await fsWriteFile(dest, 'hi');
    const client = new ICClient(primaryAccount);
    await expect(client.download('anoka', '/x', dest)).rejects.toThrow(/FileExists/);
  });

  it('sends X-XSRF-TOKEN header on download when login returns XSRF-TOKEN cookie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const loginRes = new Response('', {
      status: 200,
      headers: { 'set-cookie': 'JSESSIONID=b; Path=/' },
    });
    // Force fallback path to inject XSRF-TOKEN via comma-separated header
    (loginRes.headers as any).getSetCookie = undefined;
    Object.defineProperty(loginRes.headers, 'get', {
      value: (name: string) => {
        if (name === 'set-cookie') return 'JSESSIONID=b; Path=/, XSRF-TOKEN=tok123; Path=/';
        return null;
      },
    });
    fetchSpy
      .mockResolvedValueOnce(loginRes)
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8]), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      }));
    const dest = join(dir, 'xsrf.pdf');
    const client = new ICClient(primaryAccount);
    const meta = await client.download('anoka', '/x', dest);
    expect(meta.bytes).toBe(2);
    // Verify the download fetch included X-XSRF-TOKEN
    const dlCall = fetchSpy.mock.calls[2];
    const dlHeaders = (dlCall[1] as RequestInit).headers as Record<string, string>;
    expect(dlHeaders['X-XSRF-TOKEN']).toBe('tok123');
  });

  it('overwrites when overwrite:true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=b' } }))
      .mockResolvedValueOnce(noLinkedAccounts())
      .mockResolvedValueOnce(new Response(new Uint8Array([9,9,9]), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      }));
    const dest = join(dir, 'r.pdf');
    await fsWriteFile(dest, 'old');
    const client = new ICClient(primaryAccount);
    const meta = await client.download('anoka', '/x', dest, { overwrite: true });
    expect(meta.bytes).toBe(3);
  });
});

describe('ICClient — CUPS linked district discovery', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => vi.restoreAllMocks());

  const linkedAccount = {
    districtName: 'district2',
    clientId: 'client2',
    districtLoginUrl: 'https://d2.infinitecampus.org/campus/verify.jsp',
    appName: 'district2app',
    userId: 42,
    state: 'ACTIVE',
  };

  /** Build a mockImplementation handler for the full CUPS happy path. */
  function cupsHappyPathHandler(opts?: { tokenFail?: boolean; verifyBody?: string; verifyCookies?: boolean }) {
    return async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);

      // Primary login
      if (u.includes('anoka.infinitecampus.org/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=primary; Path=/, XSRF-TOKEN=xsrf1; Path=/' } });
      }
      // CUPS linkedAccounts
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      // CUPS loginToken
      if (u.includes('/cups/loginToken')) {
        if (opts?.tokenFail) return new Response('', { status: 403 });
        return new Response(JSON.stringify({ token: { token: 'jwt123' } }), { status: 200 });
      }
      // originalDistrict
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'orig123' }), { status: 200 });
      }
      // districts/current
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'Anoka District' }), { status: 200 });
      }
      // D2 verify (linked district login)
      if (u.includes('d2.infinitecampus.org/campus/verify.jsp')) {
        const body = opts?.verifyBody ?? '<AUTHENTICATION>success</AUTHENTICATION>';
        const headers: Record<string, string> = {};
        if (opts?.verifyCookies !== false) {
          headers['set-cookie'] = 'JSESSIONID=linked-sess; Path=/, XSRF-TOKEN=xsrf-linked; Path=/';
        }
        return new Response(body, { status: 200, headers });
      }
      // Data requests
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }

  it('discovers and authenticates a linked district on login', async () => {
    fetchSpy.mockImplementation(cupsHappyPathHandler());

    const client = new ICClient(primaryAccount);
    const result = await client.request<{ data: string }>('anoka', '/campus/api/test');
    expect(result).toEqual({ data: 'ok' });

    // Linked district should appear in listDistricts
    const districts = client.listDistricts();
    expect(districts).toHaveLength(2);
    expect(districts).toContainEqual({ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', linked: false });
    expect(districts).toContainEqual({ name: 'district2', baseUrl: 'https://d2.infinitecampus.org', linked: true });

    // Data request on linked district should work
    const linked = await client.request<{ data: string }>('district2', '/campus/api/test');
    expect(linked).toEqual({ data: 'ok' });
  });

  it('handles no linked accounts gracefully', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(1);
  });

  it('gracefully degrades when CUPS loginToken fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(cupsHappyPathHandler({ tokenFail: true }));

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');

    // Primary district works, linked not discovered
    expect(client.listDistricts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CUPS loginToken failed'));
    errorSpy.mockRestore();
  });

  it('gracefully degrades when linked district verify fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(cupsHappyPathHandler({ verifyBody: '<AUTHENTICATION>type-mismatch</AUTHENTICATION>' }));

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');

    expect(client.listDistricts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CUPS switch to district2 failed'));
    errorSpy.mockRestore();
  });

  it('gracefully degrades when linked district verify returns no cookies', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(cupsHappyPathHandler({ verifyBody: '<AUTHENTICATION>success</AUTHENTICATION>', verifyCookies: false }));

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');

    expect(client.listDistricts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no cookies'));
    errorSpy.mockRestore();
  });

  it('re-authenticates linked district through primary on 401', async () => {
    let callCount = 0;
    let linkedDataCallCount = 0;

    fetchSpy.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      callCount++;

      // Primary login
      if (u.includes('anoka.infinitecampus.org/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=primary; Path=/, XSRF-TOKEN=xsrf1; Path=/' } });
      }
      // CUPS linkedAccounts
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      // CUPS loginToken
      if (u.includes('/cups/loginToken')) {
        return new Response(JSON.stringify({ token: { token: 'jwt123' } }), { status: 200 });
      }
      // originalDistrict
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'orig123' }), { status: 200 });
      }
      // districts/current
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'Anoka District' }), { status: 200 });
      }
      // D2 verify (linked district login)
      if (u.includes('d2.infinitecampus.org/campus/verify.jsp')) {
        return new Response('<AUTHENTICATION>success</AUTHENTICATION>', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=linked-sess; Path=/, XSRF-TOKEN=xsrf-linked; Path=/' },
        });
      }
      // Data request on linked district
      if (u.includes('d2.infinitecampus.org')) {
        linkedDataCallCount++;
        // First data request on linked district returns 401, second succeeds
        if (linkedDataCallCount === 1) {
          return new Response('', { status: 401 });
        }
        return new Response(JSON.stringify({ data: 'refreshed' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Data request on primary
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    // First request on primary triggers login + CUPS discovery
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(2);

    // Request on linked district — first attempt returns 401, triggers primary re-login + re-discovery, then retry succeeds
    const result = await client.request<{ data: string }>('district2', '/campus/api/test');
    expect(result).toEqual({ data: 'refreshed' });
  });

  it('does not re-discover linked districts when logging in a linked district', async () => {
    // Set up happy path, then force TTL expiry on linked district only.
    // The re-login of primary (triggered by 401 on linked) should re-discover,
    // but the linked district itself should NOT call discoverLinkedDistricts.
    let linkedAccountsFetchCount = 0;

    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('anoka.infinitecampus.org/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=p; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        linkedAccountsFetchCount++;
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      if (u.includes('/cups/loginToken')) {
        return new Response(JSON.stringify({ token: { token: 'jwt' } }), { status: 200 });
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'c' }), { status: 200 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      if (u.includes('d2.infinitecampus.org/campus/verify.jsp')) {
        return new Response('<AUTHENTICATION>success</AUTHENTICATION>', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=l; Path=/' },
        });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(linkedAccountsFetchCount).toBe(1); // initial discovery

    // linkedAccounts is only called once per primary login, not for linked district logins
    await client.request('district2', '/campus/api/test');
    expect(linkedAccountsFetchCount).toBe(1);
  });

  it('silently skips when linkedAccounts endpoint returns non-ok', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response('', { status: 404 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(1);
  });

  it('silently skips when originalDistrict or districts/current returns non-ok', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response('', { status: 500 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(1);
  });

  it('logs and continues when CUPS flow throws an exception for one linked account', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let tokenCallCount = 0;

    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp') && u.includes('anoka')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      if (u.includes('/cups/loginToken')) {
        tokenCallCount++;
        throw new Error('network down');
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'c' }), { status: 200 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    // Should not throw despite network error in CUPS flow
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CUPS flow failed for district2'));
    errorSpy.mockRestore();
  });

  it('skips discovery when login is called for a linked district (TTL expiry path)', async () => {
    // Covers line 95: linkedTo.has(account.name) === true → skip discoverLinkedDistricts
    let linkedAccountsFetchCount = 0;

    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('anoka.infinitecampus.org/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=p; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        linkedAccountsFetchCount++;
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      if (u.includes('/cups/loginToken')) {
        return new Response(JSON.stringify({ token: { token: 'jwt' } }), { status: 200 });
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'c' }), { status: 200 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      if (u.includes('d2.infinitecampus.org/campus/verify.jsp')) {
        return new Response('<AUTHENTICATION>success</AUTHENTICATION>', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=l; Path=/' },
        });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(linkedAccountsFetchCount).toBe(1);
    expect(client.listDistricts()).toHaveLength(2);

    // Force TTL expiry on linked district to trigger login() on the synthetic account
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + sixHoursMs);

    // This will call ensureSession → login on the linked district.
    // login() succeeds (mock returns cookie for d2 verify.jsp) but does NOT call discoverLinkedDistricts.
    await client.request('district2', '/campus/api/test');
    // linkedAccounts should NOT have been called again (only primary login triggers discovery)
    expect(linkedAccountsFetchCount).toBe(1);
  });

  it('handles non-Error throw in per-account CUPS catch block', async () => {
    // Covers line 187: e instanceof Error false branch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp') && u.includes('anoka')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount] }), { status: 200 });
      }
      if (u.includes('/cups/loginToken')) {
        throw 'string-error'; // non-Error throw
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'c' }), { status: 200 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('string-error'));
    errorSpy.mockRestore();
  });

  it('handles non-Error throw in top-level discovery catch block', async () => {
    // Covers line 192: e instanceof Error false branch in outer catch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        throw 42; // non-Error throw
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    errorSpy.mockRestore();
  });

  it('invalidates all linked sessions from same primary on 401 (multi-linked)', async () => {
    // Covers line 255: loop that invalidates all linked districts from a primary.
    // Two linked districts from same primary; 401 on one should invalidate both.
    const linkedAccount2 = {
      ...linkedAccount,
      districtName: 'district3',
      clientId: 'client3',
      districtLoginUrl: 'https://d3.infinitecampus.org/campus/verify.jsp',
      appName: 'district3app',
      userId: 43,
    };
    let d2DataCalls = 0;

    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('anoka.infinitecampus.org/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=p; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        return new Response(JSON.stringify({ accounts: [linkedAccount, linkedAccount2] }), { status: 200 });
      }
      if (u.includes('/cups/loginToken')) {
        return new Response(JSON.stringify({ token: { token: 'jwt' } }), { status: 200 });
      }
      if (u.includes('/userAccountSwitch/originalDistrict')) {
        return new Response(JSON.stringify({ clientID: 'c' }), { status: 200 });
      }
      if (u.includes('/districts/current')) {
        return new Response(JSON.stringify({ name: 'P' }), { status: 200 });
      }
      if (u.includes('d2.infinitecampus.org/campus/verify.jsp') || u.includes('d3.infinitecampus.org/campus/verify.jsp')) {
        return new Response('<AUTHENTICATION>success</AUTHENTICATION>', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=l; Path=/' },
        });
      }
      if (u.includes('d2.infinitecampus.org')) {
        d2DataCalls++;
        if (d2DataCalls === 1) return new Response('', { status: 401 });
        return new Response(JSON.stringify({ data: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(3);

    // 401 on district2 should invalidate primary + all linked, then re-login primary which re-discovers all
    const result = await client.request<{ data: string }>('district2', '/campus/api/test');
    expect(result).toEqual({ data: 'ok' });
    expect(client.listDistricts()).toHaveLength(3);
  });

  it('logs top-level discoverLinkedDistricts exception without failing login', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/campus/verify.jsp')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s; Path=/' } });
      }
      if (u.includes('/cups/linkedAccounts')) {
        throw new Error('unexpected crash');
      }
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new ICClient(primaryAccount);
    // Should not throw
    await client.request('anoka', '/campus/api/test');
    expect(client.listDistricts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Linked district discovery failed'));
    errorSpy.mockRestore();
  });
});
