import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import type { Account } from './config.js';

interface Session {
  cookie: string;          // serialized "name=value; name2=value2" header
  loggedInAt: number;
  loginInFlight: Promise<void> | null;
}

const SESSION_TTL_MS = 5 * 60 * 60 * 1000; // 5h, slightly under IC's typical 6h

export interface RequestOpts {
  method?: 'GET' | 'POST';
  body?: BodyInit;
  headers?: Record<string, string>;
}

export class ICClient {
  private accounts = new Map<string, Account>();
  private sessions = new Map<string, Session>();

  constructor(accounts: Account[]) {
    for (const a of accounts) this.accounts.set(a.name, a);
  }

  listDistricts(): { name: string; baseUrl: string }[] {
    return [...this.accounts.values()].map((a) => ({ name: a.name, baseUrl: a.baseUrl }));
  }

  async request<T>(district: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const account = this.accounts.get(district);
    if (!account) throw new UnknownDistrictError(district, [...this.accounts.keys()]);
    await this.ensureSession(account);
    return this.doRequest<T>(account, path, opts, false);
  }

  private async ensureSession(account: Account): Promise<void> {
    let s = this.sessions.get(account.name);
    if (s && Date.now() - s.loggedInAt < SESSION_TTL_MS) return;
    if (s?.loginInFlight) { await s.loginInFlight; return; }

    if (!s) {
      s = { cookie: '', loggedInAt: 0, loginInFlight: null };
      this.sessions.set(account.name, s);
    }
    s.loginInFlight = this.login(account);
    try { await s.loginInFlight; } finally { s.loginInFlight = null; }
  }

  private async login(account: Account): Promise<void> {
    // Step A: GET login form to capture initial JSESSIONID
    const initRes = await fetch(
      `${account.baseUrl}/campus/portal/parents/${account.district}.jsp`,
      { redirect: 'manual' },
    );
    const initCookie = parseSetCookie(initRes.headers.get('set-cookie'));

    // Step B: POST credentials to verify endpoint
    const postRes = await fetch(
      `${account.baseUrl}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(account.username)}&password=${encodeURIComponent(account.password)}&appName=${encodeURIComponent(account.district)}&portalLoginPage=parents`,
      {
        method: 'POST',
        headers: initCookie ? { Cookie: initCookie } : {},
        redirect: 'manual',
      },
    );

    if (postRes.status >= 500) throw new PortalUnreachableError(account.name, postRes.status);
    const postCookie = parseSetCookie(postRes.headers.get('set-cookie')) || initCookie;
    if (!postCookie || postRes.status >= 400) throw new AuthFailedError(account.name);

    // Mutate the in-map session in place so concurrent callers'
    // references stay live (see ensureSession).
    const session = this.sessions.get(account.name)!;
    session.cookie = postCookie;
    session.loggedInAt = Date.now();
  }

  async download(
    district: string, path: string, destinationPath: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<{ path: string; bytes: number; contentType: string }> {
    // Pre-flight checks before authenticating, so we fail fast on bad paths
    let destStat: Awaited<ReturnType<typeof stat>> | null = null;
    try { destStat = await stat(destinationPath); } catch { /* not present, ok */ }
    if (destStat?.isDirectory()) throw new InvalidPathError(destinationPath);
    if (destStat && !opts.overwrite) throw new FileExistsError(destinationPath);

    const parent = dirname(destinationPath);
    try { await stat(parent); } catch { throw new ParentDirectoryMissingError(parent); }

    const account = this.accounts.get(district);
    if (!account) throw new UnknownDistrictError(district, [...this.accounts.keys()]);
    await this.ensureSession(account);
    const session = this.sessions.get(account.name)!;

    const res = await fetch(`${account.baseUrl}${path}`, { headers: { Cookie: session.cookie } });
    if (!res.ok) throw new Error(`IC download ${res.status} for ${path}`);

    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(destinationPath, buf);
    return {
      path: destinationPath,
      bytes: buf.byteLength,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async doRequest<T>(
    account: Account, path: string, opts: RequestOpts, isRetry: boolean,
  ): Promise<T> {
    const session = this.sessions.get(account.name)!;
    const res = await fetch(`${account.baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: { Cookie: session.cookie, Accept: 'application/json', ...(opts.headers ?? {}) },
      body: opts.body,
    });

    if (res.status === 401) {
      if (isRetry) throw new SessionExpiredError(account.name);
      this.sessions.delete(account.name);
      await this.ensureSession(account);
      return this.doRequest<T>(account, path, opts, true);
    }
    if (res.status >= 500) throw new PortalUnreachableError(account.name, res.status);
    if (!res.ok) throw new Error(`IC ${res.status} ${res.statusText} for ${path}`);

    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

function parseSetCookie(header: string | null): string {
  if (!header) return '';
  // Take first cookie's name=value, drop attributes
  return header.split(',').map((c) => c.split(';')[0].trim()).join('; ');
}

export class UnknownDistrictError extends Error {
  constructor(public district: string, public available: string[]) {
    super(`Unknown district '${district}'. Configured: [${available.join(', ')}]`);
    this.name = 'UnknownDistrictError';
  }
}

export class AuthFailedError extends Error {
  constructor(public district: string) {
    super(`Login failed for district '${district}'. Check IC_N_USERNAME and IC_N_PASSWORD.`);
    this.name = 'AuthFailedError';
  }
}

export class PortalUnreachableError extends Error {
  constructor(public district: string, public status: number) {
    super(`Portal unreachable for district '${district}' (status ${status})`);
    this.name = 'PortalUnreachableError';
  }
}

export class SessionExpiredError extends Error {
  constructor(public district: string) {
    super(`Session expired for district '${district}' after re-login retry`);
    this.name = 'SessionExpiredError';
  }
}

export class InvalidPathError extends Error {
  constructor(public path: string) {
    super(`InvalidPath: destinationPath must be a filename, not a directory: ${path}`);
    this.name = 'InvalidPathError';
  }
}
export class ParentDirectoryMissingError extends Error {
  constructor(public path: string) {
    super(`ParentDirectoryMissing: ${path}`);
    this.name = 'ParentDirectoryMissingError';
  }
}
export class FileExistsError extends Error {
  constructor(public path: string) {
    super(`FileExists at ${path}. Pass overwrite:true to replace.`);
    this.name = 'FileExistsError';
  }
}
