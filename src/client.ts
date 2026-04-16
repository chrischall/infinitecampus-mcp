import { writeFile, mkdir, stat } from 'fs/promises';
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

    const flight = this.login(account);
    if (!s) {
      s = { cookie: '', loggedInAt: 0, loginInFlight: flight };
      this.sessions.set(account.name, s);
    } else {
      s.loginInFlight = flight;
    }
    try { await flight; } finally { s.loginInFlight = null; }
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
      `${account.baseUrl}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(account.username)}&password=${encodeURIComponent(account.password)}&appName=${encodeURIComponent(account.district)}`,
      {
        method: 'POST',
        headers: initCookie ? { Cookie: initCookie } : {},
        redirect: 'manual',
      },
    );

    if (postRes.status >= 500) throw new PortalUnreachableError(account.name, postRes.status);
    const postCookie = parseSetCookie(postRes.headers.get('set-cookie')) || initCookie;
    if (!postCookie || postRes.status >= 400) throw new AuthFailedError(account.name);

    this.sessions.set(account.name, {
      cookie: postCookie,
      loggedInAt: Date.now(),
      loginInFlight: null,
    });
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
