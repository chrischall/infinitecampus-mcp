// ────────────────────────────────────────────────────────────────────────────
// Auth resolution — Pattern A template
// ────────────────────────────────────────────────────────────────────────────
//
// Infinite Campus supports two auth paths. This file picks one, in priority
// order, and hands the chosen path to `ICClient`. It mirrors the Pattern A
// shape used by ofw-mcp/src/auth.ts (and signupgenius-mcp, zola-mcp, …) so
// all sibling MCPs in this family stay structurally aligned.
//
// THE PATHS, in priority order:
//
//   1. Password login (existing)
//      IC_BASE_URL + IC_DISTRICT + IC_USERNAME + IC_PASSWORD set →
//      `loadAccount()` returns an Account with credentials; `ICClient.login()`
//      POSTs to `verify.jsp` exactly as before. Unchanged from pre-fetchproxy
//      behavior. The 401 retry + linked-district CUPS SSO discovery in
//      `client.ts` both keep working.
//
//   2. fetchproxy fallback (new)
//      IC_BASE_URL + IC_DISTRICT set but no IC_USERNAME/IC_PASSWORD →
//      `@fetchproxy/bootstrap` opens a one-shot WebSocket bridge to the
//      0.3.0 extension, reads `JSESSIONID` (HttpOnly) and `XSRF-TOKEN`
//      (non-HttpOnly) cookies from the user's signed-in IC portal tab via
//      `chrome.cookies.get`, then closes the bridge. The client receives
//      pre-loaded session cookies and skips the login POST. All subsequent
//      IC calls go out via plain Node `fetch()` — fetchproxy is NOT in the
//      request hot path.
//
//      The CUPS linked-district token-minting flow in `client.ts` continues
//      to work unchanged because it only needs the primary district's
//      cookies, which fetchproxy provides on initial bootstrap.
//
//      IC_BASE_URL + IC_DISTRICT remain REQUIRED in this mode — the MCP
//      needs to know which host to declare (the extension whitelists by
//      host suffix) and which district appName to dispatch CUPS calls on.
//
//      Users opt out with IC_DISABLE_FETCHPROXY=1 (e.g. headless CI where
//      no extension is available — turns missing creds into a hard error).
//
//   3. Error
//      Nothing to authenticate with. We throw a message that names both
//      escape hatches: set IC_USERNAME/IC_PASSWORD, OR install the extension
//      and sign in.
//
// Testability:
//   - `@fetchproxy/bootstrap` is mocked at the module boundary in tests.
//   - `loadAccount()` (the existing env-var resolver) is reused as-is so the
//     legacy paths keep working unchanged.

import { bootstrap } from '@fetchproxy/bootstrap';
import { classifyBridgeError, FetchproxyBridgeDownError } from '@fetchproxy/server';
import { loadAccount, type Account } from './config.js';
import pkg from '../package.json' with { type: 'json' };

/** Result of resolving auth, regardless of which path was taken. */
export interface ResolvedAuth {
  /**
   * Account config the client should treat as authoritative. For the env
   * path this is the full Account with creds. For the fetchproxy path the
   * `username` + `password` fields are empty strings and the client uses
   * `preloaded` instead of POSTing to `verify.jsp`.
   */
  account: Account;
  /**
   * For the fetchproxy path: pre-loaded session cookies pulled from the
   * browser. The client uses these in place of running its login flow.
   * For the env path this is undefined and the client follows its normal
   * lazy-login flow.
   */
  preloaded?: {
    cookieHeader: string;
    xsrfToken: string;
  };
  /** Which path produced this. Diagnostics only — callers should not branch. */
  source: 'env' | 'fetchproxy';
}

function readEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'undefined' || trimmed === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

function fetchproxyDisabled(): boolean {
  const raw = readEnv('IC_DISABLE_FETCHPROXY');
  if (raw === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * Resolve IC auth using the path priority described at the top of this file.
 * Throws with an actionable message when no path succeeds.
 */
export async function resolveAuth(): Promise<ResolvedAuth> {
  // `loadAccount()` enforces IC_BASE_URL + IC_DISTRICT + https validation
  // and the "both username/password or neither" rule. Any of those failing
  // is a user mistake; we let them propagate so the user can fix the typo.
  const account = loadAccount();

  // ── Path 1: full env-var credentials.
  if (account.username && account.password) {
    return { account, source: 'env' };
  }

  // ── Path 2: fetchproxy fallback.
  if (!fetchproxyDisabled()) {
    try {
      const host = new URL(account.baseUrl).hostname;
      const session = await bootstrap({
        serverName: pkg.name,
        version: pkg.version,
        // IC tenants live on per-district hosts (campus.<district>.org,
        // <district>.infinitecampus.org, etc.). Declare just this host
        // — each district is its own root, no wildcard needed.
        domains: [host],
        declare: {
          // JSESSIONID is HttpOnly (chrome.cookies.get sees it; the
          // security gate is the declared key list). XSRF-TOKEN is
          // non-HttpOnly because the page JS reads it back and echoes
          // it on every state-changing call as the X-XSRF-TOKEN header.
          cookies: ['JSESSIONID', 'XSRF-TOKEN'],
          localStorage: [],
          sessionStorage: [],
          captureHeaders: [],
        },
      });

      const jsessionid = session.cookies['JSESSIONID'];
      const xsrf = session.cookies['XSRF-TOKEN'];
      if (!jsessionid) {
        throw new Error(
          `JSESSIONID cookie not found on ${host}. ` +
            'Sign into your IC portal in your browser (with the fetchproxy extension installed) and retry.',
        );
      }
      if (!xsrf) {
        throw new Error(
          `XSRF-TOKEN cookie not found on ${host}. ` +
            'Sign into your IC portal in your browser (with the fetchproxy extension installed) and retry.',
        );
      }

      return {
        account,
        preloaded: {
          cookieHeader: `JSESSIONID=${jsessionid}; XSRF-TOKEN=${xsrf}`,
          xsrfToken: xsrf,
        },
        source: 'fetchproxy',
      };
    } catch (e) {
      // 0.8.0+ typed-error discrimination. The fetchproxy server already
      // retries once on SW eviction (bridgeReviveDelayMs=2000 default), so
      // a thrown FetchproxyBridgeDownError means the retry also failed —
      // the extension's service worker is genuinely down and the user
      // needs to wake it. The `.hint` is the actionable copy
      // ("click the extension toolbar icon...") that we'd otherwise have
      // to hand-write here. Surface it verbatim so users in path 2 get
      // the same self-service guidance as path 3.
      if (classifyBridgeError(e) === 'bridge_down') {
        const downErr = e as FetchproxyBridgeDownError;
        throw new Error(
          `IC auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${downErr.hint}`,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        'IC auth: no IC_USERNAME/IC_PASSWORD set, and fetchproxy fallback failed: ' + msg,
      );
    }
  }

  // ── Path 3: nothing configured and fetchproxy explicitly disabled.
  throw new Error(
    'IC auth: set IC_USERNAME + IC_PASSWORD, ' +
      'or install the fetchproxy extension and sign into your IC portal ' +
      '(unset IC_DISABLE_FETCHPROXY if it is set).',
  );
}
