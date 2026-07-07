import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import { parseCookieJar } from '@chrischall/mcp-utils';
import { createCookieSessionManager, type CookieSessionManager } from '@chrischall/mcp-utils/session';
import type { Account } from './config.js';

/** Cookie session for one district, minted by verify.jsp or a CUPS switch. */
interface ICSession {
  cookieHeader: string;    // serialized "name=value; name2=value2" header
  xsrfToken: string;       // XSRF-TOKEN value for X-XSRF-TOKEN request header
}

export interface DisplayOptions { [key: string]: boolean; }

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
  responseType?: 'json' | 'text';
}

export class ICClient {
  private accounts = new Map<string, Account>();
  /**
   * One CookieSessionManager per district (primary + each discovered linked
   * district). The manager owns the session lifecycle: single-flight login,
   * `withSession` exactly-one 401 replay, `invalidate()`, permanent-error
   * caching, proactive `maxAgeMs` (SESSION_TTL_MS) expiry, and — for linked
   * districts — the CUPS-minted session installed via `seed()` during
   * discovery.
   */
  private managers = new Map<string, CookieSessionManager<ICSession>>();
  private linkedTo = new Map<string, string>(); // linkedDistrictName → primaryDistrictName
  private primaryName: string;
  private featuresCache = new Map<string, { data: DisplayOptions; fetchedAt: number }>();
  /**
   * True when the primary account has empty creds (fetchproxy mode). The
   * client uses pre-loaded cookies in place of the `verify.jsp` POST and
   * cannot re-login when those cookies expire — the user must re-sign-in
   * in the browser. CUPS linked-district discovery still runs lazily on
   * first call to `ensureDiscovery()`.
   */
  private fetchproxyMode = false;
  private fetchproxyDiscoveryRan = false;
  /** fetchproxy cookies, consumed by the primary manager's first login. */
  private preloaded: { cookieHeader: string; xsrfToken: string } | null = null;

  /**
   * `preloaded` is the fetchproxy escape hatch: when set, the client treats
   * the supplied cookies as a freshly-completed login on the primary account.
   * This skips the `verify.jsp` POST entirely (the account has empty creds
   * in this mode) but otherwise behaves identically — CUPS linked-district
   * discovery still runs on first request, 401 retry still triggers a
   * re-login. On a 401 with empty credentials we can't re-login from Node;
   * the user must re-sign-in in the browser.
   */
  constructor(
    account: Account,
    opts: { preloaded?: { cookieHeader: string; xsrfToken: string } } = {},
  ) {
    this.accounts.set(account.name, account);
    this.primaryName = account.name;
    this.managers.set(account.name, this.makeManager(account));
    if (opts.preloaded) {
      this.preloaded = opts.preloaded;
      this.fetchproxyMode = true;
    }
  }

  /**
   * Build the per-district CookieSessionManager.
   *
   * - `maxAgeMs: SESSION_TTL_MS` makes `ensure()` proactively invalidate and
   *   re-login a session older than 5h (single-flight), replacing IC's old
   *   hand-rolled `ensureFresh` wrapper. `now` reads `Date.now` at call time so
   *   the clock stays mockable in tests.
   * - `isPermanentError` caches the one config error the process can never
   *   recover from (fetchproxy no-creds) so `ensure()` fails fast instead of
   *   pointlessly retrying a login that can never succeed.
   * - `onReplayLoginError` rethrows the re-login failure from `withSession`'s
   *   expiry-replay path. By default that failure is swallowed and the stale
   *   401 returned; rethrowing surfaces the actionable error (e.g. fetchproxy's
   *   "sign back into your IC portal in the browser") to the caller instead of
   *   a generic SessionExpiredError — the behavior IC's `lastLoginError`
   *   bookkeeping used to provide.
   */
  private makeManager(account: Account): CookieSessionManager<ICSession> {
    return createCookieSessionManager<ICSession>({
      login: () => this.login(account),
      isExpired: (res) => this.detectExpiredSession(account.name, res),
      isPermanentError: (e) => e instanceof AuthFailedError && e.permanent,
      maxAgeMs: SESSION_TTL_MS,
      now: () => Date.now(),
      onReplayLoginError: (err) => { throw err; },
    });
  }

  /**
   * `isExpired` predicate for `withSession`: a 401 means the session died.
   * Side effect for linked districts: the shared CUPS SSO umbrella died with
   * it, so drop the primary and every *sibling* linked session too — the
   * linked district's re-login (via `login()`'s linked branch) then re-logs
   * the primary in, whose discovery re-establishes all of them. `withSession`
   * invalidates the requesting district itself. Mirrors the old hand-rolled
   * doRequest 401 handling.
   */
  private detectExpiredSession(district: string, res: Response): boolean {
    if (res.status !== 401) return false;
    const primaryName = this.linkedTo.get(district);
    if (primaryName) {
      this.managers.get(primaryName)!.invalidate();
      for (const linked of this.linkedTo.keys()) {
        if (linked !== district) this.managers.get(linked)!.invalidate();
      }
    }
    return true;
  }

  async ensureDiscovery(): Promise<void> {
    // Ensure primary account is logged in, which triggers CUPS linked-district discovery
    const session = await this.managers.get(this.primaryName)!.ensure();
    // fetchproxy mode skips the verify.jsp login and therefore the discovery
    // call inside it. Run discovery directly the first time someone asks for
    // it. The primary is never in linkedTo (it's the root of the linkedTo
    // map). When login() runs for an already-linked district during a TTL
    // refresh, it re-auths through the primary instead of running discovery
    // itself.
    if (this.fetchproxyMode && !this.fetchproxyDiscoveryRan) {
      this.fetchproxyDiscoveryRan = true;
      await this.discoverLinkedDistricts(this.accounts.get(this.primaryName)!, session);
    }
  }

  listDistricts(): { name: string; baseUrl: string; linked: boolean }[] {
    return [...this.accounts.values()].map((a) => ({
      name: a.name,
      baseUrl: a.baseUrl,
      linked: this.linkedTo.has(a.name),
    }));
  }

  /**
   * Fetch the per-structure displayOptions feature-flag allowlist for a student.
   * Results are cached per (district, structureID) for the duration of the
   * session TTL — flags rarely change mid-session and the call costs ~1 RT.
   */
  async getFeatures(
    district: string, structureID: number, studentId: string,
  ): Promise<DisplayOptions> {
    const key = `${district}:${structureID}`;
    const cached = this.featuresCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < SESSION_TTL_MS) return cached.data;
    const data = await this.request<DisplayOptions>(
      district,
      `/campus/api/portal/displayOptions/${structureID}?personID=${encodeURIComponent(studentId)}`,
    );
    this.featuresCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  }

  async request<T>(district: string, path: string, opts: RequestOpts = {}): Promise<T> {
    let account = this.accounts.get(district);
    if (!account) {
      // Cold-start: linked districts are only added to the accounts map after
      // primary login + CUPS discovery. If the caller asks for a linked
      // district before any other request triggered login, we'd otherwise
      // throw UnknownDistrictError despite the district being valid. Run
      // discovery once before giving up.
      await this.ensureDiscovery();
      account = this.accounts.get(district);
      if (!account) throw new UnknownDistrictError(district, [...this.accounts.keys()]);
    }
    const session = await this.managers.get(account.name)!.ensure();
    // In fetchproxy mode, the preloaded-cookie login never runs verify.jsp
    // and therefore never calls discoverLinkedDistricts. Run discovery once
    // on the first primary call so linked districts are discoverable. (The
    // primary is never in linkedTo by construction.)
    if (this.fetchproxyMode && !this.fetchproxyDiscoveryRan && account.name === this.primaryName) {
      this.fetchproxyDiscoveryRan = true;
      await this.discoverLinkedDistricts(account, session);
    }
    return this.doRequest<T>(account, path, opts);
  }

  private async login(account: Account): Promise<ICSession> {
    // Linked districts have no real credentials of their own — they hold
    // synthetic '(linked)' placeholders and are authenticated by the primary's
    // CUPS SSO switch, not by their own verify.jsp. Whether the linked session
    // expired by TTL or by 401 (detectExpiredSession dropped the primary in
    // that case), re-auth through the primary: refresh it, which re-runs
    // discoverLinkedDistricts and `seed()`s a fresh session into this
    // district's manager — POSTing the placeholder creds to verify.jsp would
    // instead yield a misleading password-error.
    //
    // This runs as the linked manager's `login`, which `ensure()` only invokes
    // after invalidating any stale session — so `current` is `undefined` on
    // entry and becomes non-undefined ONLY if the primary refresh re-ran
    // discovery and seeded us. If the primary was still fresh (or discovery
    // failed to restore this district), `current` stays undefined — surface a
    // clear error rather than handing callers a dead session.
    const primaryName = this.linkedTo.get(account.name);
    if (primaryName) {
      await this.managers.get(primaryName)!.ensure();
      const restored = this.managers.get(account.name)!.current;
      if (!restored) {
        throw new AuthFailedError(
          account.name,
          'linked-district session could not be re-established via the primary district',
          { credentialHint: false },
        );
      }
      return restored;
    }

    // fetchproxy mode: the first primary login consumes the preloaded browser
    // cookies instead of POSTing to verify.jsp. Consumed exactly once — after
    // an expiry/invalidate there is nothing left to re-login with (below).
    if (this.preloaded) {
      const { cookieHeader, xsrfToken } = this.preloaded;
      this.preloaded = null;
      return { cookieHeader, xsrfToken };
    }

    // fetchproxy mode: empty primary creds, can't post to verify.jsp.
    // The user must re-sign-in in the browser (and the next process start
    // will pick up the fresh cookies). Marked permanent: the manager caches
    // and rethrows this instead of retrying a login that can never succeed.
    if (!account.username || !account.password) {
      throw new AuthFailedError(
        account.name,
        'session expired and no IC_USERNAME/IC_PASSWORD set — ' +
          'sign back into your IC portal in the browser and restart the MCP',
        { permanent: true },
      );
    }

    // ic_parent_api's pattern: single POST to verify.jsp, let the response
    // set cookies. No pre-login GET needed (unlike OFW's Spring Security).
    // Credentials go in the urlencoded form body, NOT the URL query string —
    // query-string creds land in proxy/LB/server access logs even over HTTPS.
    // Mirrors the CUPS switch POST body construction against the same host.
    const postRes = await fetch(
      `${account.baseUrl}/campus/verify.jsp?nonBrowser=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: account.username,
          password: account.password,
          appName: account.district,
          portalLoginPage: 'parents',
        }).toString(),
      },
    );

    if (postRes.status >= 500) throw new PortalUnreachableError(account.name, postRes.status);

    // IC's verify.jsp returns 200 with an <AUTHENTICATION>X</AUTHENTICATION>
    // body where X is the auth state (success / password-error / account-locked
    // / etc.). 4xx is also possible on misconfigured endpoints. Surface the
    // actual reason so the LLM can give the user something useful.
    const body = await postRes.text();
    if (postRes.status >= 400) {
      throw new AuthFailedError(account.name, `HTTP ${postRes.status} from verify.jsp`);
    }
    const authMatch = body.match(/<AUTHENTICATION>([^<]+)<\/AUTHENTICATION>/i);
    const authState = authMatch?.[1]?.trim().toLowerCase() ?? '';
    if (authState === 'password-error') {
      throw new AuthFailedError(account.name, 'IC returned password-error — wrong username or password');
    }
    if (authState && authState !== 'success') {
      throw new AuthFailedError(account.name, `IC returned authentication state '${authState}'`);
    }

    // Capture cookies, deduplicating and filtering out deletions (Max-Age=0).
    const cookies = parseSetCookies(postRes.headers);
    if (!cookies.cookieHeader) {
      throw new AuthFailedError(account.name, 'login response missing session cookies');
    }

    const session: ICSession = {
      cookieHeader: cookies.cookieHeader,
      xsrfToken: cookies.xsrfToken,
    };

    // Discover linked districts (CUPS SSO) — non-blocking, errors logged not
    // thrown. By construction we only reach here for the primary: linked
    // districts return early above and re-auth via the primary, so no
    // `linkedTo` guard is needed.
    await this.discoverLinkedDistricts(account, session);
    return session;
  }

  private async discoverLinkedDistricts(account: Account, session: ICSession): Promise<void> {
    try {
      const baseHeaders = {
        Cookie: session.cookieHeader,
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

          // Store synthetic account + `seed()` the freshly-minted CUPS session
          // into the linked district's own manager. `seed()` installs it with a
          // fresh maxAgeMs clock and DETACHES any in-flight login — so when this
          // discovery is itself being awaited by a mid-flight linked `login()`
          // (the re-auth-through-primary path), that login's late resolution
          // won't overwrite the seed. The manager must exist before we seed it.
          const syntheticAccount: Account = {
            name: linked.districtName,
            baseUrl: linkedBaseUrl,
            district: linked.appName,
            username: '(linked)',
            password: '(linked)',
          };
          this.accounts.set(linked.districtName, syntheticAccount);
          this.linkedTo.set(linked.districtName, account.name);
          if (!this.managers.has(linked.districtName)) {
            this.managers.set(linked.districtName, this.makeManager(syntheticAccount));
          }
          this.managers.get(linked.districtName)!.seed({
            cookieHeader: switchCookies.cookieHeader,
            xsrfToken: switchCookies.xsrfToken,
          });
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
    const session = await this.managers.get(account.name)!.ensure();

    // Support both relative paths (/campus/...) and absolute URLs
    // (e.g. report-card URLs from ic_list_documents come fully-qualified).
    const url = /^https?:\/\//i.test(path) ? path : `${account.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        Cookie: session.cookieHeader,
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

  private async doRequest<T>(account: Account, path: string, opts: RequestOpts): Promise<T> {
    const mgr = this.managers.get(account.name)!;
    const accept = opts.responseType === 'text' ? 'text/html, text/plain, */*' : 'application/json';
    // withSession: on a 401 (detectExpiredSession, which also drops the
    // primary + sibling sessions for a linked district), the manager
    // invalidates this district, re-logs-in single-flight, and replays the
    // request EXACTLY once.
    const res = await mgr.withSession(async (session) =>
      fetch(`${account.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          Cookie: session.cookieHeader,
          Accept: accept,
          ...(session.xsrfToken ? { 'X-XSRF-TOKEN': session.xsrfToken } : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body,
      }),
    );

    if (res.status === 401) {
      // We only reach here when the re-login SUCCEEDED but the replayed request
      // 401'd again (a fresh session the portal still rejects). If the re-login
      // itself failed, the `onReplayLoginError` hook already rethrew that
      // error out of `withSession` — carrying the actionable message (e.g.
      // fetchproxy's "sign back into your IC portal") — so control never
      // reaches this branch in that case.
      throw new SessionExpiredError(account.name);
    }
    if (res.status >= 500) throw new PortalUnreachableError(account.name, res.status);
    if (!res.ok) throw new Error(`IC ${res.status} ${res.statusText} for ${path}`);

    const text = await res.text();
    if (opts.responseType === 'text') {
      return text as T;
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}

/**
 * Parse Set-Cookie headers into a deduplicated Cookie header + XSRF token via
 * `parseCookieJar` (see inline comment for the splitter/jar details).
 */
function parseSetCookies(headers: Headers): { cookieHeader: string; xsrfToken: string } {
  // Prefer the structured getSetCookie() split (one cookie per array entry,
  // what real Node fetch Responses provide). When it's unavailable, hand the
  // joined `set-cookie` string to parseCookieJar, which splits it defensively
  // (safe around the commas inside `Expires` dates, unlike a naive comma
  // split). parseCookieJar then does the jar logic: drop deletion markers
  // (Max-Age=0 / expired Expires) and empty values, dedupe by name. That's
  // load-bearing so the synthesized Cookie header never carries both the
  // `appName=` deletion and the real value (IC rejects "conflicting app name").
  const raw = headers.getSetCookie?.() ?? [];
  const { cookies, cookieHeader } = parseCookieJar(
    raw.length > 0 ? raw : headers.get('set-cookie'),
  );
  return { cookieHeader, xsrfToken: cookies['XSRF-TOKEN'] ?? '' };
}

export class UnknownDistrictError extends Error {
  constructor(public district: string, public available: string[]) {
    super(`Unknown district '${district}'. Configured: [${available.join(', ')}]`);
    this.name = 'UnknownDistrictError';
  }
}

export class AuthFailedError extends Error {
  /**
   * A *permanent* configuration failure: retrying the login inside this
   * process can never succeed (e.g. fetchproxy mode with no creds — the user
   * must re-sign-in in the browser and restart). CookieSessionManager caches
   * and rethrows permanent errors instead of retrying.
   */
  public permanent: boolean;

  /**
   * @param opts.credentialHint When `false`, the message omits the
   *   "Check IC_USERNAME and IC_PASSWORD" suffix — used for failures where the
   *   credentials are known-good (e.g. a linked-district CUPS/SSO re-discovery
   *   failure) and pointing the user at their creds would be misleading.
   * @param opts.permanent See {@link AuthFailedError.permanent}.
   */
  constructor(
    public district: string,
    public reason?: string,
    opts?: { credentialHint?: boolean; permanent?: boolean },
  ) {
    const detail = reason ? ` (${reason})` : '';
    const remedy =
      opts?.credentialHint === false
        ? 'Sign in again at the IC portal in your browser, then restart the MCP.'
        : 'Check IC_USERNAME and IC_PASSWORD; ' +
          'if those are correct, the account may be locked or the portal may be down.';
    super(`Login failed for district '${district}'${detail}. ${remedy}`);
    this.name = 'AuthFailedError';
    this.permanent = opts?.permanent ?? false;
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
