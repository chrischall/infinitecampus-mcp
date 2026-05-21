/**
 * Read an env var, trim whitespace, and treat as unset if blank or if the value
 * looks like an unsubstituted shell placeholder (e.g. `${FOO}`) — defends
 * against MCP hosts that pass .mcp.json env blocks through unexpanded.
 */
function readVar(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'undefined' || trimmed === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

export interface Account {
  name: string;
  baseUrl: string;
  district: string;
  /** Empty string when creds are not set (fetchproxy fallback path). */
  username: string;
  /** Empty string when creds are not set (fetchproxy fallback path). */
  password: string;
}

/**
 * Load the Account from env vars. IC_BASE_URL + IC_DISTRICT are ALWAYS
 * required (the MCP needs to know which host to talk to and which district to
 * dispatch on). IC_USERNAME + IC_PASSWORD must be set together or omitted
 * together — partial creds are treated as a user mistake and throw rather
 * than falling through to fetchproxy (which would mask the typo).
 *
 * When username/password are omitted the resolved Account carries empty
 * strings. The caller (`resolveAuth()`) treats that as "try fetchproxy".
 */
export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const baseUrl = readVar(env, 'IC_BASE_URL');
  const district = readVar(env, 'IC_DISTRICT');
  const username = readVar(env, 'IC_USERNAME');
  const password = readVar(env, 'IC_PASSWORD');
  const name = readVar(env, 'IC_NAME') ?? district;

  // IC_BASE_URL + IC_DISTRICT are always required.
  const missing: string[] = [];
  if (!baseUrl) missing.push('IC_BASE_URL');
  if (!district) missing.push('IC_DISTRICT');

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
      'Set IC_BASE_URL (your portal URL) and IC_DISTRICT (the app-name path segment).',
    );
  }

  if (!/^https:\/\//.test(baseUrl!)) {
    throw new Error(`IC_BASE_URL must be an https URL, got: '${baseUrl}'`);
  }

  // Username + password must be set together or omitted together. Partial
  // configuration is almost always a typo, so surface it rather than silently
  // falling through to fetchproxy.
  if ((username && !password) || (!username && password)) {
    const partialMissing: string[] = [];
    if (!username) partialMissing.push('IC_USERNAME');
    if (!password) partialMissing.push('IC_PASSWORD');
    throw new Error(
      `Missing required env var(s) for password auth: ${partialMissing.join(', ')}. ` +
      'Set both IC_USERNAME and IC_PASSWORD, or leave both unset to use the fetchproxy ' +
      'fallback (requires the fetchproxy browser extension and a signed-in IC portal tab).',
    );
  }

  return {
    name: name!,
    baseUrl: baseUrl!.replace(/\/$/, ''),
    district: district!,
    username: username ?? '',
    password: password ?? '',
  };
}
