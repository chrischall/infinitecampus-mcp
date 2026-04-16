import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import type { Account } from './config.js';

interface Session {
  cookie: string;          // serialized "name=value; name2=value2" header
  xsrfToken: string;       // XSRF-TOKEN value for X-XSRF-TOKEN request header
  loggedInAt: number;
  loginInFlight: Promise<void> | null;
}

interface LinkedAccount {
  districtName: string;
  clientId: string;
  districtLoginUrl: string;
  appName: string;
  userId: number;
  state: string;
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
  private linkedTo = new Map<string, string>(); // linkedDistrictName → primaryDistrictName
  private primaryName: string;

  constructor(account: Account) {
    this.accounts.set(account.name, account);
    this.primaryName = account.name;
  }

  async ensureDiscovery(): Promise<void> {
    // Ensure primary account is logged in, which triggers CUPS linked-district discovery
    await this.ensureSession(this.accounts.get(this.primaryName)!);
  }

  listDistricts(): { name: string; baseUrl: string; linked: boolean }[] {
    return [...this.accounts.values()].map((a) => ({
      name: a.name,
      baseUrl: a.baseUrl,
      linked: this.linkedTo.has(a.name),
    }));
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
      s = { cookie: '', xsrfToken: '', loggedInAt: 0, loginInFlight: null };
      this.sessions.set(account.name, s);
    }
    s.loginInFlight = this.login(account);
    try { await s.loginInFlight; } finally { s.loginInFlight = null; }
  }

  private async login(account: Account): Promise<void> {
    // ic_parent_api's pattern: single POST to verify.jsp, let the response
    // set cookies. No pre-login GET needed (unlike OFW's Spring Security).
    const postRes = await fetch(
      `${account.baseUrl}/campus/verify.jsp?nonBrowser=true&username=${encodeURIComponent(account.username)}&password=${encodeURIComponent(account.password)}&appName=${encodeURIComponent(account.district)}&portalLoginPage=parents`,
      { method: 'POST' },
    );

    if (postRes.status >= 500) throw new PortalUnreachableError(account.name, postRes.status);

    // Check for login failure — IC returns 200 with "password-error" in the
    // body on bad credentials, not a 4xx status code.
    const body = await postRes.text();
    if (postRes.status >= 400 || body.includes('password-error')) {
      throw new AuthFailedError(account.name);
    }

    // Capture cookies, deduplicating and filtering out deletions (Max-Age=0).
    const cookies = parseSetCookies(postRes.headers);
    if (!cookies.cookieHeader) throw new AuthFailedError(account.name);

    // Mutate the in-map session in place so concurrent callers'
    // references stay live (see ensureSession).
    const session = this.sessions.get(account.name)!;
    session.cookie = cookies.cookieHeader;
    session.xsrfToken = cookies.xsrfToken;
    session.loggedInAt = Date.now();

    // Discover linked districts (CUPS SSO) — non-blocking, errors logged not thrown
    if (!this.linkedTo.has(account.name)) {
      await this.discoverLinkedDistricts(account);
    }
  }

  private async discoverLinkedDistricts(account: Account): Promise<void> {
    try {
      const session = this.sessions.get(account.name)!;
      const baseHeaders = {
        Cookie: session.cookie,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: `${account.baseUrl}/campus/nav-wrapper/`,
        Origin: account.baseUrl,
        ...(session.xsrfToken ? { 'X-XSRF-TOKEN': session.xsrfToken } : {}),
      };

      // 1. Get linked accounts
      const laRes = await fetch(
        `${account.baseUrl}/campus/api/campus/authentication/cups/linkedAccounts`,
        { headers: baseHeaders },
      );
      if (!laRes.ok) return; // silently skip if endpoint doesn't exist
      const laData = await laRes.json() as { accounts: LinkedAccount[] };
      if (!laData.accounts?.length) return;

      // 2. Get original district info (needed for all linked accounts)
      const [origRes, currRes] = await Promise.all([
        fetch(`${account.baseUrl}/campus/api/campus/user/userAccountSwitch/originalDistrict`, { headers: baseHeaders }),
        fetch(`${account.baseUrl}/campus/api/campus/districts/current`, { headers: baseHeaders }),
      ]);
      if (!origRes.ok || !currRes.ok) return;
      const origData = await origRes.json() as { clientID: string };
      const currData = await currRes.json() as { name: string };

      // 3. For each linked account, get CUPS token and authenticate
      for (const linked of laData.accounts) {
        try {
          // Get CUPS login token
          const tokenRes = await fetch(
            `${account.baseUrl}/campus/api/campus/authentication/cups/loginToken`,
            {
              method: 'POST',
              headers: baseHeaders,
              body: JSON.stringify({ dstClientId: linked.clientId, dstUserId: linked.userId }),
            },
          );
          if (!tokenRes.ok) { console.error(`[ic] CUPS loginToken failed for ${linked.districtName}`); continue; }
          const tokenData = await tokenRes.json() as { token: { token: string } };

          // Extract base URL from districtLoginUrl
          const linkedBaseUrl = new URL(linked.districtLoginUrl).origin;

          // POST to linked district's verify.jsp with CUPS token
          const switchRes = await fetch(
            `${linked.districtLoginUrl}?nonBrowser=true&appName=${encodeURIComponent(linked.appName)}&portalLoginPage=parents`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                cupsToken: tokenData.token.token,
                originalDistrictClientID: origData.clientID,
                previousDistrictName: currData.name,
                loggedIntoCampusParent: 'true',
              }).toString(),
            },
          );

          const body = await switchRes.text();
          if (!body.includes('success')) { console.error(`[ic] CUPS switch to ${linked.districtName} failed: ${body.substring(0, 100)}`); continue; }

          const switchCookies = parseSetCookies(switchRes.headers);
          if (!switchCookies.cookieHeader) { console.error(`[ic] CUPS switch to ${linked.districtName}: no cookies`); continue; }

          // Store synthetic account + session
          const syntheticAccount: Account = {
            name: linked.districtName,
            baseUrl: linkedBaseUrl,
            district: linked.appName,
            username: '(linked)',
            password: '(linked)',
          };
          this.accounts.set(linked.districtName, syntheticAccount);
          this.sessions.set(linked.districtName, {
            cookie: switchCookies.cookieHeader,
            xsrfToken: switchCookies.xsrfToken,
            loggedInAt: Date.now(),
            loginInFlight: null,
          });
          this.linkedTo.set(linked.districtName, account.name);
          console.error(`[ic] Linked district discovered: ${linked.districtName} (${linked.appName})`);
        } catch (e) {
          console.error(`[ic] CUPS flow failed for ${linked.districtName}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      // Don't fail primary login on linked-district errors
      console.error(`[ic] Linked district discovery failed: ${e instanceof Error ? e.message : e}`);
    }
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

    const res = await fetch(`${account.baseUrl}${path}`, {
      headers: {
        Cookie: session.cookie,
        ...(session.xsrfToken ? { 'X-XSRF-TOKEN': session.xsrfToken } : {}),
      },
    });
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
      headers: {
        Cookie: session.cookie,
        Accept: 'application/json',
        ...(session.xsrfToken ? { 'X-XSRF-TOKEN': session.xsrfToken } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body,
    });

    if (res.status === 401) {
      if (isRetry) throw new SessionExpiredError(account.name);
      this.sessions.delete(account.name);

      const primaryName = this.linkedTo.get(account.name);
      if (primaryName) {
        // Linked district 401: invalidate primary + all linked sessions so re-login rediscovers
        this.sessions.delete(primaryName);
        for (const [linked] of this.linkedTo) {
          this.sessions.delete(linked);
        }
        const primaryAccount = this.accounts.get(primaryName)!;
        await this.ensureSession(primaryAccount);
      } else {
        await this.ensureSession(account);
      }
      return this.doRequest<T>(account, path, opts, true);
    }
    if (res.status >= 500) throw new PortalUnreachableError(account.name, res.status);
    if (!res.ok) throw new Error(`IC ${res.status} ${res.statusText} for ${path}`);

    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

/**
 * Parse Set-Cookie headers into a deduplicated cookie string + XSRF token.
 *
 * IC's login response sets ~20 cookies including deletion markers (Max-Age=0).
 * Sending both `appName=` (delete) and `appName=springfield` (set) causes IC to
 * reject requests with "conflicting app name values". This parser:
 * - Filters out cookies with Max-Age=0 (deletion markers)
 * - Deduplicates by name (last value wins)
 * - Extracts XSRF-TOKEN separately for the X-XSRF-TOKEN request header
 */
function parseSetCookies(headers: Headers): { cookieHeader: string; xsrfToken: string } {
  const raw = headers.getSetCookie?.() ?? [];
  const headerStrings = raw.length > 0 ? raw : splitFallback(headers.get('set-cookie'));

  const jar = new Map<string, string>();
  let xsrfToken = '';

  for (const entry of headerStrings) {
    // Check for Max-Age=0 → this is a cookie deletion, skip it
    if (/Max-Age=0/i.test(entry)) continue;

    const nameValue = entry.split(';')[0].trim();
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx < 1) continue;

    const name = nameValue.substring(0, eqIdx);
    const value = nameValue.substring(eqIdx + 1);

    // Skip cookies with empty values (clearing instructions)
    if (!value) continue;

    jar.set(name, value);
    if (name === 'XSRF-TOKEN') xsrfToken = value;
  }

  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  return { cookieHeader, xsrfToken };
}

function splitFallback(header: string | null): string[] {
  if (!header) return [];
  return header.split(',').map((s) => s.trim());
}

export class UnknownDistrictError extends Error {
  constructor(public district: string, public available: string[]) {
    super(`Unknown district '${district}'. Configured: [${available.join(', ')}]`);
    this.name = 'UnknownDistrictError';
  }
}

export class AuthFailedError extends Error {
  constructor(public district: string) {
    super(`Login failed for district '${district}'. Check IC_USERNAME and IC_PASSWORD.`);
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
