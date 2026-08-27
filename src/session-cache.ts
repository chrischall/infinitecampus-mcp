import {
  createFileStatePersistence,
  resolveStateFile,
  type PersistedCookieSession,
  type SyncStatePersistence,
} from '@chrischall/mcp-utils/session';
import { readEnvVar, parseBoolEnv } from '@chrischall/mcp-utils';

/** The cookie session this server persists: the jar header plus its XSRF token. */
export interface StoredICSession {
  cookieHeader: string;
  /** Required, matching ICSession — the X-XSRF-TOKEN header every write needs. */
  xsrfToken: string;
}

/**
 * Where the primary district's session is cached between runs.
 *
 * Per district, because a deployment can point at more than one Infinite Campus
 * instance and their sessions are unrelated — one shared file would have each
 * clobber the other, and every record would then fail its own binding check.
 */
export function sessionCachePath(
  env: NodeJS.ProcessEnv = process.env,
  district?: string | null,
): string {
  const seg = (district ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 64);
  return resolveStateFile({
    env,
    envVar: 'IC_SESSION_FILE',
    subdir: '.infinitecampus-mcp',
    fileName: seg === '' ? 'session.json' : `session-${seg}.json`,
  });
}

/** Guard the stored envelope: a usable cookie header, and a login time. */
function isStored(raw: unknown): raw is PersistedCookieSession<StoredICSession> {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Partial<PersistedCookieSession<StoredICSession>>;
  if (typeof r.sessionAt !== 'number') return false;
  const s = r.session as Partial<StoredICSession> | undefined;
  if (s === null || typeof s !== 'object') return false;
  // An empty header is not a session — restoring one would look authenticated
  // and then 401 every request until the expiry heuristic caught it.
  if (typeof s.cookieHeader !== 'string' || s.cookieHeader === '') return false;
  // Required rather than optional: a restored session missing it would read as
  // authenticated and then fail every write that needs the X-XSRF-TOKEN header.
  return typeof s.xsrfToken === 'string';
}

/** Options for {@link createSessionCache}. */
export interface SessionCacheOptions {
  env?: NodeJS.ProcessEnv;
  /** The primary district this cache belongs to. */
  district: string;
  /** Base URL, part of the binding: the same login at another instance is a different session. */
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  /** True in fetchproxy mode, where credentials are empty by design. */
  browserBacked?: boolean;
}

/**
 * The session cache for the PRIMARY district, or `null` when disabled.
 *
 * Only the primary is cached. Linked districts hold synthetic `(linked)`
 * credentials and are authenticated by the primary's CUPS SSO switch, then
 * `seed()`ed into their managers by discovery — so a linked session restored on
 * its own would be a session with no `linkedTo` entry behind it. Caching the
 * primary is what makes the expensive part free; discovery re-runs from the
 * restored session and re-establishes the rest.
 *
 * In fetchproxy mode the credentials are empty by design and the session comes
 * from a signed-in browser tab. That is worth caching MORE, not less: a cached
 * session lets a cold start proceed with no browser present, and this mode
 * cannot re-login unaided when it lapses.
 */
export function createSessionCache(
  opts: SessionCacheOptions,
): SyncStatePersistence<PersistedCookieSession<StoredICSession>> | null {
  const env = opts.env ?? process.env;
  if (!parseBoolEnv('IC_SESSION_CACHE', { env, default: true })) return null;

  const username = opts.username ?? readEnvVar('IC_USERNAME', { env });
  const password = opts.password ?? readEnvVar('IC_PASSWORD', { env });
  const boundTo =
    username && password
      ? ['login', opts.baseUrl, username.trim().toLowerCase(), password].join('\u0000')
      : opts.browserBacked === true
        ? ['fetchproxy', opts.baseUrl].join('\u0000')
        : null;
  if (boundTo === null) return null;

  return createFileStatePersistence<PersistedCookieSession<StoredICSession>>({
    filePath: sessionCachePath(env, opts.district),
    boundTo,
    validate: (raw) => (isStored(raw) ? raw : null),
  });
}

/**
 * Report a cache write that failed. Not fatal in env mode: the session is
 * re-mintable from the credentials. In fetchproxy mode a lost write costs the
 * next start a trip through the browser, which is worse but still recoverable —
 * and failing the request would not make the browser any more available.
 *
 * stderr only; stdout is the JSON-RPC channel.
 */
export function reportCacheWriteFailure(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(
    `[infinitecampus-mcp] could not cache the session (${detail}); continuing without ` +
      'the cache — every restart will authenticate again until this is fixed.',
  );
}
