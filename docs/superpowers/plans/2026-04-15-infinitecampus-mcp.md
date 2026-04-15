# Infinite Campus MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js MCP server exposing the Campus Parent portal of Infinite Campus (multi-district) with 13 tools across 10 domains.

**Architecture:** TypeScript over `@modelcontextprotocol/sdk` (stdio), mirrors the [ofw-mcp](https://github.com/chrischall/ofw-mcp) repo. Single `ICClient` owns a `Map<district, Session>` for per-district cookie jars; lazy login on first request, re-login once on 401. Each tool module exports `register<Domain>Tools(server, client)`. Vitest with `vi.spyOn(client, 'request')` for tool tests.

**Tech Stack:** Node 22, TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `dotenv`, `vitest`, `esbuild`.

**Reference repos** (for endpoint paths and response shapes — implementer reads these per-tool):
- Primary: https://github.com/schwartzpub/ic_parent_api (Python, parent portal)
- Secondary: https://github.com/tonyzimbinski/infinite-campus (Node, request patterns)
- Tertiary: https://github.com/gilesgc/Infinite-Campus-API (Python, cross-check)

**Spec:** [`docs/superpowers/specs/2026-04-15-infinitecampus-mcp-design.md`](../specs/2026-04-15-infinitecampus-mcp-design.md)

---

## File Structure

```
infinitecampus-mcp/
├── .gitignore
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── CLAUDE.md
├── manifest.json
├── .claude-plugin/plugin.json
├── src/
│   ├── index.ts              # MCP server bootstrap, tool registration
│   ├── config.ts             # loadAccounts(env) → Account[]
│   ├── client.ts             # ICClient: per-district sessions, request, download
│   └── tools/
│       ├── districts.ts      # ic_list_districts
│       ├── students.ts       # ic_list_students
│       ├── schedule.ts       # ic_get_schedule
│       ├── assignments.ts    # ic_list_assignments
│       ├── grades.ts         # ic_list_grades
│       ├── attendance.ts     # ic_list_attendance
│       ├── messages.ts       # ic_list_messages, ic_get_message,
│       │                     # ic_send_message, ic_list_message_recipients
│       ├── behavior.ts       # ic_list_behavior
│       ├── foodservice.ts    # ic_list_food_service
│       └── documents.ts      # ic_list_documents, ic_download_document
└── tests/
    ├── config.test.ts
    ├── client.test.ts
    ├── fixtures/             # sanitized JSON captures (created per-tool when implementing)
    └── tools/                # one .test.ts per src/tools/ file
```

---

## Phase 1 — Project scaffolding

### Task 1: Create package.json, tsconfig, vitest config, .gitignore, .env.example

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "infinitecampus-mcp",
  "version": "0.1.0",
  "description": "Infinite Campus (Campus Parent) MCP server — multi-district read + message/document write",
  "author": "Claude Code (AI) <https://www.anthropic.com/claude>",
  "license": "MIT",
  "type": "module",
  "bin": {
    "infinitecampus-mcp": "dist/index.js"
  },
  "files": ["dist", ".claude-plugin", "skills", ".mcp.json"],
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --outfile=dist/bundle.js",
    "dev": "node --env-file=.env dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^17.4.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.5.2",
    "@vitest/coverage-v8": "^4.1.2",
    "esbuild": "^0.28.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
```

- [ ] **Step 5: Write `.env.example`**

```
# Each Infinite Campus parent account is a numbered IC_N_* group.
# Loader scans IC_1_*, IC_2_*, ... until it hits a gap.

IC_1_NAME=anoka
IC_1_BASE_URL=https://anoka.infinitecampus.org
IC_1_DISTRICT=anoka
IC_1_USERNAME=parent@example.com
IC_1_PASSWORD=

IC_2_NAME=
IC_2_BASE_URL=
IC_2_DISTRICT=
IC_2_USERNAME=
IC_2_PASSWORD=

IC_3_NAME=
IC_3_BASE_URL=
IC_3_DISTRICT=
IC_3_USERNAME=
IC_3_PASSWORD=
```

- [ ] **Step 6: Install deps**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: project scaffold (package.json, tsconfig, vitest, env example)"
```

---

### Task 2: Stub `src/index.ts` so the project builds

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write minimal entry**

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'infinitecampus', version: '0.1.0' });

console.error('[infinitecampus-mcp] This project was developed and is maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `dist/index.js` and `dist/bundle.js` produced, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "chore: stub MCP server entry"
```

---

## Phase 2 — Config

### Task 3: TDD `loadAccounts()` — happy path + gap-stops-scan

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadAccounts } from '../src/config.js';

const baseEnv = {
  IC_1_NAME: 'anoka',
  IC_1_BASE_URL: 'https://anoka.infinitecampus.org',
  IC_1_DISTRICT: 'anoka',
  IC_1_USERNAME: 'parent@example.com',
  IC_1_PASSWORD: 'secret',
};

describe('loadAccounts', () => {
  it('parses a single account', () => {
    const accounts = loadAccounts(baseEnv);
    expect(accounts).toEqual([{
      name: 'anoka',
      baseUrl: 'https://anoka.infinitecampus.org',
      district: 'anoka',
      username: 'parent@example.com',
      password: 'secret',
    }]);
  });

  it('parses three sequential accounts', () => {
    const env = {
      ...baseEnv,
      IC_2_NAME: 'mpls', IC_2_BASE_URL: 'https://mpls.infinitecampus.org',
      IC_2_DISTRICT: 'mpls', IC_2_USERNAME: 'u2', IC_2_PASSWORD: 'p2',
      IC_3_NAME: 'stp', IC_3_BASE_URL: 'https://stp.infinitecampus.org',
      IC_3_DISTRICT: 'stp', IC_3_USERNAME: 'u3', IC_3_PASSWORD: 'p3',
    };
    expect(loadAccounts(env)).toHaveLength(3);
  });

  it('stops scanning at the first gap', () => {
    const env = {
      ...baseEnv,
      // IC_2_* deliberately missing
      IC_3_NAME: 'stp', IC_3_BASE_URL: 'https://stp.infinitecampus.org',
      IC_3_DISTRICT: 'stp', IC_3_USERNAME: 'u3', IC_3_PASSWORD: 'p3',
    };
    expect(loadAccounts(env)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `src/config.js` not found.

- [ ] **Step 3: Write `src/config.ts`**

```ts
export interface Account {
  name: string;
  baseUrl: string;
  district: string;
  username: string;
  password: string;
}

const FIELDS = ['NAME', 'BASE_URL', 'DISTRICT', 'USERNAME', 'PASSWORD'] as const;

function readSlot(env: NodeJS.ProcessEnv | Record<string, string | undefined>, n: number) {
  const out: Partial<Record<typeof FIELDS[number], string>> = {};
  let any = false;
  for (const f of FIELDS) {
    const v = env[`IC_${n}_${f}`];
    if (v && v.length > 0) {
      out[f] = v;
      any = true;
    }
  }
  return { any, fields: out };
}

export function loadAccounts(env = process.env): Account[] {
  const accounts: Account[] = [];
  const seenNames = new Set<string>();

  for (let n = 1; n < 1000; n++) {
    const { any, fields } = readSlot(env, n);
    if (!any) break;

    const missing = FIELDS.filter((f) => !fields[f]);
    if (missing.length > 0) {
      throw new Error(
        `Account IC_${n} is incomplete: missing ${missing.join(', ')}. ` +
        `Required vars: ${FIELDS.join(', ')}.`,
      );
    }

    if (seenNames.has(fields.NAME!)) {
      throw new Error(
        `Duplicate district name '${fields.NAME}' in IC_${n}. Names must be unique.`,
      );
    }
    seenNames.add(fields.NAME!);

    if (!/^https:\/\//.test(fields.BASE_URL!)) {
      throw new Error(`IC_${n}_BASE_URL is not a valid https URL: '${fields.BASE_URL}'`);
    }

    accounts.push({
      name: fields.NAME!,
      baseUrl: fields.BASE_URL!.replace(/\/$/, ''),
      district: fields.DISTRICT!,
      username: fields.USERNAME!,
      password: fields.PASSWORD!,
    });
  }

  if (accounts.length === 0) {
    throw new Error(
      'No Infinite Campus accounts configured. Set IC_1_NAME, IC_1_BASE_URL, ' +
      'IC_1_DISTRICT, IC_1_USERNAME, IC_1_PASSWORD (and IC_2_*, IC_3_* for more).',
    );
  }

  return accounts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for all 3 happy-path tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): loadAccounts parses IC_N_* env vars with gap-stop scan"
```

---

### Task 4: TDD `loadAccounts()` — error paths

**Files:**
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add failing tests for each error path**

```ts
describe('loadAccounts errors', () => {
  it('throws when no accounts configured', () => {
    expect(() => loadAccounts({})).toThrow(/No Infinite Campus accounts configured/);
  });

  it('throws on partial account', () => {
    const env = { ...baseEnv, IC_1_PASSWORD: undefined as unknown as string };
    expect(() => loadAccounts(env)).toThrow(/Account IC_1 is incomplete: missing PASSWORD/);
  });

  it('throws on duplicate district name', () => {
    const env = {
      ...baseEnv,
      IC_2_NAME: 'anoka',
      IC_2_BASE_URL: 'https://anoka2.infinitecampus.org',
      IC_2_DISTRICT: 'anoka', IC_2_USERNAME: 'u2', IC_2_PASSWORD: 'p2',
    };
    expect(() => loadAccounts(env)).toThrow(/Duplicate district name 'anoka' in IC_2/);
  });

  it('throws on non-https BASE_URL', () => {
    const env = { ...baseEnv, IC_1_BASE_URL: 'http://anoka.infinitecampus.org' };
    expect(() => loadAccounts(env)).toThrow(/IC_1_BASE_URL is not a valid https URL/);
  });

  it('strips trailing slash from BASE_URL', () => {
    const env = { ...baseEnv, IC_1_BASE_URL: 'https://anoka.infinitecampus.org/' };
    expect(loadAccounts(env)[0].baseUrl).toBe('https://anoka.infinitecampus.org');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All PASS — error paths are already implemented in Task 3.

- [ ] **Step 3: Verify coverage**

Run: `npx vitest run --coverage`
Expected: `src/config.ts` at 100% lines/branches/functions.

- [ ] **Step 4: Commit**

```bash
git add tests/config.test.ts
git commit -m "test(config): cover all error paths"
```

---

## Phase 3 — Client

### Task 5: `ICClient` skeleton + `listDistricts`

**Files:**
- Create: `src/client.ts`
- Create: `tests/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client.test.ts
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/client.js` not found.

- [ ] **Step 3: Write `src/client.ts` skeleton**

```ts
import { writeFile } from 'fs/promises';
import { dirname } from 'path';
import { mkdir, stat } from 'fs/promises';
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
}

export function makeUnknownDistrictError(district: string, available: string[]) {
  return new UnknownDistrictError(district, available);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for `listDistricts` test.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): ICClient skeleton with listDistricts and error classes"
```

---

### Task 6: `ICClient.request` — login + cookie capture + happy GET

**Note for implementer:** Before writing the login implementation, read [`schwartzpub/ic_parent_api/__init__.py`](https://github.com/schwartzpub/ic_parent_api) and locate the `_login` method. Capture the exact GET/POST sequence and form fields it uses. The skeleton below uses a generic shape; replace with the verified one.

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// add to tests/client.test.ts
import { vi, beforeEach, afterEach } from 'vitest';

describe('ICClient.request — login + GET', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => vi.restoreAllMocks());

  function mockLoginThenGet(jsonData: unknown) {
    // 1st call: GET login form → 200 with Set-Cookie: JSESSIONID=...
    // 2nd call: POST login → 302 redirect (followed automatically), success
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `request` not implemented.

- [ ] **Step 3: Implement `request` and `login` on `ICClient`**

```ts
// add to src/client.ts inside ICClient class

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

// add at module level
function parseSetCookie(header: string | null): string {
  if (!header) return '';
  // Take first cookie's name=value, drop attributes
  return header.split(',').map((c) => c.split(';')[0].trim()).join('; ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for both new tests.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): lazy per-district login, cookie reuse, request method"
```

---

### Task 7: `ICClient.request` — 401 retry + concurrent login dedup

**Files:**
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS for retry tests; the concurrent-dedup test may FAIL on first run if the implementation kicks off two logins. Inspect and adjust `ensureSession` so the in-flight promise is set BEFORE the first await point.

- [ ] **Step 3: Fix any concurrency issue if needed**

If concurrent-dedup test fails, ensure `ensureSession` reads the existing session entry, sets `loginInFlight` synchronously, then awaits — without yielding the event loop in between.

- [ ] **Step 4: Commit**

```bash
git add tests/client.test.ts src/client.ts
git commit -m "test(client): cover 401 retry, session expiry, concurrent login dedup"
```

---

### Task 8: `ICClient.download` — stream PDF to disk

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `download` not implemented.

- [ ] **Step 3: Add `download` and error classes**

```ts
// add to src/client.ts

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

// inside ICClient class
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all download tests.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): download() streams to disk with path safety checks"
```

---

## Phase 4 — First two tools end-to-end

### Task 9: `ic_list_districts`

**Files:**
- Create: `src/tools/districts.ts`
- Create: `tests/tools/districts.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/tools/districts.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerDistrictTools } from '../../src/tools/districts.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

const accounts = [
  { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' },
  { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org', district: 'mpls', username: 'u', password: 'p' },
];

let handlers: Map<string, ToolHandler>;

function setup() {
  const client = new ICClient(accounts);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _config: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerDistrictTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_districts', () => {
  it('returns configured districts (no creds)', async () => {
    setup();
    const result = await handlers.get('ic_list_districts')!({});
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([
      { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org' },
      { name: 'mpls', baseUrl: 'https://mpls.infinitecampus.org' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `src/tools/districts.js` not found.

- [ ] **Step 3: Implement `src/tools/districts.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ICClient } from '../client.js';

export function registerDistrictTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_districts', {
    description: 'List Infinite Campus districts configured for this MCP server. Returns names + base URLs (no credentials).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = client.listDistricts();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Run test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/districts.ts tests/tools/districts.test.ts
git commit -m "feat(tools): ic_list_districts"
```

---

### Task 10: `ic_list_students` (first network tool)

**Note for implementer:** Read [`ic_parent_api`'s student listing endpoint](https://github.com/schwartzpub/ic_parent_api) (look for `students` method) to confirm the exact path. The skeleton uses `/campus/api/portal/parents/students`; verify and adjust.

**Files:**
- Create: `src/tools/students.ts`
- Create: `tests/tools/students.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/tools/students.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerStudentTools } from '../../src/tools/students.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];

let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerStudentTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_students', () => {
  it('calls the parent students endpoint for the given district', async () => {
    const raw = [{ personID: 12345, firstName: 'Alex', lastName: 'Doe', grade: '07' }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_students')!({ district: 'anoka' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('/students'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('rejects when district arg is missing', async () => {
    setup([]);
    await expect(handlers.get('ic_list_students')!({})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `src/tools/students.js` not found.

- [ ] **Step 3: Implement `src/tools/students.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerStudentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_students', {
    description: 'List students enrolled under the parent account for a given district.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string().describe('District name from ic_list_districts'),
    },
  }, async (args) => {
    const data = await client.request(args.district, '/campus/api/portal/parents/students');
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Run test**

Run: `npm test`
Expected: PASS for both tests.

- [ ] **Step 5: Commit**

```bash
git add src/tools/students.ts tests/tools/students.test.ts
git commit -m "feat(tools): ic_list_students"
```

---

### Task 11: Wire `index.ts` to load config + register all tools so far

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts`**

```ts
#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // dotenv not available — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAccounts } from './config.js';
import { ICClient } from './client.js';
import { registerDistrictTools } from './tools/districts.js';
import { registerStudentTools } from './tools/students.js';

const accounts = loadAccounts();
const client = new ICClient(accounts);
const server = new McpServer({ name: 'infinitecampus', version: '0.1.0' });

registerDistrictTools(server, client);
registerStudentTools(server, client);

console.error(`[infinitecampus-mcp] Loaded ${accounts.length} district(s): ${accounts.map((a) => a.name).join(', ')}`);
console.error('[infinitecampus-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire config + ICClient + districts/students tools"
```

---

## Phase 5 — Read-only domain tools

For Tasks 12–17 below, follow this same template per tool. Each task is its own commit. The implementer **must** read the relevant section of `ic_parent_api` before each tool to confirm the endpoint path and response shape — the path strings shown are placeholders derived from the spec, not verified.

### Task 12: `ic_get_schedule`

**Files:**
- Create: `src/tools/schedule.ts`
- Create: `tests/tools/schedule.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — schedule/roster method.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/schedule.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerScheduleTools } from '../../src/tools/schedule.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerScheduleTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_get_schedule', () => {
  it('calls schedule endpoint with studentId', async () => {
    const raw = [{ period: 1, course: 'Math', room: '203' }];
    const client = setup(raw);
    const result = await handlers.get('ic_get_schedule')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('12345'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('passes date arg through when provided', async () => {
    const client = setup([]);
    await handlers.get('ic_get_schedule')!({ district: 'anoka', studentId: '12345', date: '2026-04-15' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('2026-04-15'));
  });

  it('rejects when studentId is missing', async () => {
    setup([]);
    await expect(handlers.get('ic_get_schedule')!({ district: 'anoka' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/schedule.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerScheduleTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_get_schedule', {
    description: "Get a student's class schedule for a given date (default: today).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string().describe('District name from ic_list_districts'),
      studentId: z.string().describe('Student personID from ic_list_students'),
      date: z.string().describe('YYYY-MM-DD; defaults to today').optional(),
      termFilter: z.string().describe('Term name or ID; optional').optional(),
    },
  }, async (args) => {
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({ personID: args.studentId, date });
    if (args.termFilter) params.set('term', args.termFilter);
    const data = await client.request(args.district, `/campus/api/portal/parents/schedule?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import and `registerScheduleTools(server, client);` call alongside the others.

- [ ] **Step 5: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/tools/schedule.ts tests/tools/schedule.test.ts src/index.ts
git commit -m "feat(tools): ic_get_schedule"
```

---

### Task 13: `ic_list_assignments`

**Files:**
- Create: `src/tools/assignments.ts`
- Create: `tests/tools/assignments.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — assignments method.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/assignments.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAssignmentTools } from '../../src/tools/assignments.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAssignmentTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_assignments', () => {
  const raw = [
    { id: 1, courseName: 'Math', title: 'HW1', missing: false, scored: true, points: 10 },
    { id: 2, courseName: 'Sci', title: 'Lab', missing: true, scored: false, points: null },
  ];

  it('returns all assignments by default', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('filters to missingOnly when requested', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', missingOnly: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(2);
  });

  it('passes courseId, since, until through to the request URL', async () => {
    const client = setup([]);
    await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', courseId: 'C1', since: '2026-03-01', until: '2026-04-15',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('C1');
    expect(url).toContain('2026-03-01');
    expect(url).toContain('2026-04-15');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/assignments.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

interface RawAssignment {
  id: number;
  courseName: string;
  title: string;
  missing: boolean;
  scored: boolean;
  points: number | null;
  due?: string;
}

export function registerAssignmentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_assignments', {
    description: "List a student's assignments. Filterable by course and date range; missingOnly returns only un-submitted past-due work.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
      courseId: z.string().optional(),
      since: z.string().describe('YYYY-MM-DD').optional(),
      until: z.string().describe('YYYY-MM-DD').optional(),
      missingOnly: z.boolean().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.courseId) params.set('sectionID', args.courseId);
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    const raw = await client.request<RawAssignment[]>(
      args.district, `/campus/api/portal/parents/assignments?${params}`,
    );
    const data = args.missingOnly ? raw.filter((a) => a.missing) : raw;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`** and run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/assignments.ts tests/tools/assignments.test.ts src/index.ts
git commit -m "feat(tools): ic_list_assignments with missingOnly filter"
```

---

### Task 14: `ic_list_grades`

**Files:**
- Create: `src/tools/grades.ts`
- Create: `tests/tools/grades.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — grades method.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/grades.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerGradeTools } from '../../src/tools/grades.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerGradeTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_grades', () => {
  it('calls grades endpoint with studentId', async () => {
    const raw = [{ courseName: 'Math', grade: 'A-', percent: 91 }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_grades')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('12345'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('passes termId when provided', async () => {
    const client = setup([]);
    await handlers.get('ic_list_grades')!({ district: 'anoka', studentId: '12345', termId: 'T3' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('T3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/grades.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerGradeTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_grades', {
    description: "List a student's term grades and in-progress course grades.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
      termId: z.string().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.termId) params.set('termID', args.termId);
    const data = await client.request(args.district, `/campus/api/portal/parents/grades?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/grades.ts tests/tools/grades.test.ts src/index.ts
git commit -m "feat(tools): ic_list_grades"
```

---

### Task 15: `ic_list_attendance`

**Files:**
- Create: `src/tools/attendance.ts`
- Create: `tests/tools/attendance.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — attendance method.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/attendance.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAttendanceTools } from '../../src/tools/attendance.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAttendanceTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_attendance', () => {
  it('calls attendance endpoint with studentId and date range', async () => {
    const client = setup([]);
    await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01', until: '2026-04-15',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('12345');
    expect(url).toContain('2026-01-01');
    expect(url).toContain('2026-04-15');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/attendance.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerAttendanceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_attendance', {
    description: "List a student's absences and tardies in a date range.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
      since: z.string().describe('YYYY-MM-DD').optional(),
      until: z.string().describe('YYYY-MM-DD').optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    const data = await client.request(args.district, `/campus/api/portal/parents/attendance?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/attendance.ts tests/tools/attendance.test.ts src/index.ts
git commit -m "feat(tools): ic_list_attendance"
```

---

### Task 16: `ic_list_behavior`

**Files:**
- Create: `src/tools/behavior.ts`
- Create: `tests/tools/behavior.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — behavior method. **Note on feature-detection:** many districts disable the behavior module. If the endpoint returns 404, the tool should return `{warning: 'FeatureDisabled', feature: 'behavior', district, data: []}` instead of throwing.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/behavior.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerBehaviorTools } from '../../src/tools/behavior.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(impl: () => Promise<unknown>) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockImplementation(impl);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerBehaviorTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_behavior', () => {
  it('returns behavior events on success', async () => {
    setup(async () => [{ id: 1, type: 'minor', date: '2026-04-01' }]);
    const result = await handlers.get('ic_list_behavior')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 1, type: 'minor', date: '2026-04-01' }]);
  });

  it('returns FeatureDisabled warning on 404', async () => {
    setup(async () => { throw new Error('IC 404 Not Found for /x'); });
    const result = await handlers.get('ic_list_behavior')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ warning: 'FeatureDisabled', feature: 'behavior', district: 'anoka', data: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/behavior.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerBehaviorTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_behavior', {
    description: "List a student's behavior events / referrals. Returns FeatureDisabled if the district has the behavior module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
      since: z.string().optional(),
      until: z.string().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/api/portal/parents/behavior?${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && /\b404\b/.test(e.message)) {
        const warn = { warning: 'FeatureDisabled', feature: 'behavior', district: args.district, data: [] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/behavior.ts tests/tools/behavior.test.ts src/index.ts
git commit -m "feat(tools): ic_list_behavior with FeatureDisabled fallback on 404"
```

---

### Task 17: `ic_list_food_service`

**Files:**
- Create: `src/tools/foodservice.ts`
- Create: `tests/tools/foodservice.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — food service / lunch method. Same FeatureDisabled-on-404 pattern as behavior.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/foodservice.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerFoodServiceTools } from '../../src/tools/foodservice.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(impl: () => Promise<unknown>) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockImplementation(impl);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerFoodServiceTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_food_service', () => {
  it('returns balance + transactions on success', async () => {
    setup(async () => ({ balance: 12.5, transactions: [] }));
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual({ balance: 12.5, transactions: [] });
  });

  it('returns FeatureDisabled warning on 404', async () => {
    setup(async () => { throw new Error('IC 404 Not Found'); });
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'foodService', district: 'anoka',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/foodservice.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerFoodServiceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_food_service', {
    description: "List a student's lunch balance and recent food-service transactions. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
      since: z.string().optional(),
      until: z.string().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/api/portal/parents/foodService?${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && /\b404\b/.test(e.message)) {
        const warn = { warning: 'FeatureDisabled', feature: 'foodService', district: args.district, data: { balance: null, transactions: [] } };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/foodservice.ts tests/tools/foodservice.test.ts src/index.ts
git commit -m "feat(tools): ic_list_food_service with FeatureDisabled fallback"
```

---

## Phase 6 — Messages domain

### Task 18: `ic_list_messages` + `ic_get_message`

**Files:**
- Create: `src/tools/messages.ts`
- Create: `tests/tools/messages.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — inbox/messages methods. Confirm folder semantics (inbox/sent identifiers).

- [ ] **Step 1: Write the test**

```ts
// tests/tools/messages.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerMessageTools } from '../../src/tools/messages.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerMessageTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_messages', () => {
  it('defaults to inbox folder', async () => {
    const client = setup([]);
    await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('inbox');
  });

  it('passes folder, page, and size', async () => {
    const client = setup([]);
    await handlers.get('ic_list_messages')!({ district: 'anoka', folder: 'sent', page: 2, size: 25 });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('sent');
    expect(url).toContain('page=2');
    expect(url).toContain('size=25');
  });
});

describe('ic_get_message', () => {
  it('calls /messages/<id>', async () => {
    const client = setup({ id: 'abc', subject: 'Hi' });
    await handlers.get('ic_get_message')!({ district: 'anoka', messageId: 'abc' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('/abc'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `ic_list_messages` + `ic_get_message` in `src/tools/messages.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerMessageTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_messages', {
    description: 'List portal inbox or sent messages (district announcements, teacher notes).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      folder: z.enum(['inbox', 'sent']).default('inbox').optional(),
      page: z.number().int().positive().optional(),
      size: z.number().int().positive().optional(),
    },
  }, async (args) => {
    const folder = args.folder ?? 'inbox';
    const params = new URLSearchParams({
      folder, page: String(args.page ?? 1), size: String(args.size ?? 50),
    });
    const data = await client.request(args.district, `/campus/api/portal/parents/messages?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_get_message', {
    description: 'Get a single portal message by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      messageId: z.string(),
    },
  }, async (args) => {
    const data = await client.request(args.district, `/campus/api/portal/parents/messages/${encodeURIComponent(args.messageId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/messages.ts tests/tools/messages.test.ts src/index.ts
git commit -m "feat(tools): ic_list_messages + ic_get_message"
```

---

### Task 19: `ic_list_message_recipients`

**Files:**
- Modify: `src/tools/messages.ts`
- Modify: `tests/tools/messages.test.ts`

**Reference:** `ic_parent_api` — recipient discovery (often the teacher list per course).

- [ ] **Step 1: Add failing test**

```ts
describe('ic_list_message_recipients', () => {
  it('returns teachers + counselors for a student', async () => {
    const raw = [{ recipientId: 'T1', name: 'Mrs. Smith', role: 'teacher' }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_message_recipients')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('12345'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Add tool registration to `src/tools/messages.ts`** (inside `registerMessageTools`)

```ts
server.registerTool('ic_list_message_recipients', {
  description: "List people the parent can message about this student (teachers + counselors). IDs returned here are the only valid recipientIds for ic_send_message.",
  annotations: { readOnlyHint: true },
  inputSchema: {
    district: z.string(),
    studentId: z.string(),
  },
}, async (args) => {
  const data = await client.request(args.district, `/campus/api/portal/parents/messageRecipients?personID=${encodeURIComponent(args.studentId)}`);
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});
```

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/messages.ts tests/tools/messages.test.ts
git commit -m "feat(tools): ic_list_message_recipients"
```

---

### Task 20: `ic_send_message` with recipient validation

**Files:**
- Modify: `src/tools/messages.ts`
- Modify: `tests/tools/messages.test.ts`

**Reference:** `ic_parent_api` — send message method (POST body shape, content-type).

- [ ] **Step 1: Add failing tests**

```ts
describe('ic_send_message', () => {
  it('validates recipient IDs against ic_list_message_recipients before POST', async () => {
    const client = new ICClient(accounts);
    // First call (recipient lookup) returns valid IDs; second call would be the POST.
    vi.spyOn(client, 'request')
      .mockResolvedValueOnce([{ recipientId: 'T1', name: 'Mrs. Smith' }])
      .mockResolvedValueOnce({ ok: true });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((n: string, _c, cb) => {
      handlers.set(n, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_send_message')!({
      district: 'anoka', studentId: '12345',
      recipientIds: ['T1'], subject: 'Q', body: 'B',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ ok: true });
  });

  it('returns InvalidRecipient error when ID not in recipients list', async () => {
    const client = new ICClient(accounts);
    vi.spyOn(client, 'request').mockResolvedValueOnce([{ recipientId: 'T1', name: 'Mrs. Smith' }]);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((n: string, _c, cb) => {
      handlers.set(n, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_send_message')!({
      district: 'anoka', studentId: '12345',
      recipientIds: ['BAD'], subject: 'Q', body: 'B',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ error: 'InvalidRecipient', invalidIds: ['BAD'], validIds: ['T1'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Add tool to `src/tools/messages.ts`** (inside `registerMessageTools`)

```ts
server.registerTool('ic_send_message', {
  description: 'Send a portal message to a teacher/counselor about a student. recipientIds MUST come from ic_list_message_recipients for that student.',
  annotations: { destructiveHint: true },
  inputSchema: {
    district: z.string(),
    studentId: z.string().describe('Student personID; used to validate recipient IDs'),
    recipientIds: z.array(z.string()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
  },
}, async (args) => {
  // Validate recipients against the same student's recipients list
  const valid = await client.request<Array<{ recipientId: string }>>(
    args.district,
    `/campus/api/portal/parents/messageRecipients?personID=${encodeURIComponent(args.studentId)}`,
  );
  const validIds = valid.map((v) => v.recipientId);
  const invalidIds = args.recipientIds.filter((id) => !validIds.includes(id));
  if (invalidIds.length > 0) {
    const err = { error: 'InvalidRecipient', invalidIds, validIds };
    return { content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }] };
  }

  const data = await client.request(args.district, '/campus/api/portal/parents/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipientIds: args.recipientIds,
      subject: args.subject,
      body: args.body,
      personID: args.studentId,
    }),
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});
```

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/messages.ts tests/tools/messages.test.ts
git commit -m "feat(tools): ic_send_message with recipient validation"
```

---

## Phase 7 — Documents

### Task 21: `ic_list_documents` (metadata only)

**Files:**
- Create: `src/tools/documents.ts`
- Create: `tests/tools/documents.test.ts`
- Modify: `src/index.ts`

**Reference:** `ic_parent_api` — reports / documents method.

- [ ] **Step 1: Write the test**

```ts
// tests/tools/documents.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerDocumentTools } from '../../src/tools/documents.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(client: ICClient) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerDocumentTools(server, client);
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_documents', () => {
  it('returns document metadata array', async () => {
    const client = new ICClient(accounts);
    vi.spyOn(client, 'request').mockResolvedValue([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/documents.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

export function registerDocumentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_documents', {
    description: "List a student's available documents (report cards, transcripts, etc.). Returns metadata only — use ic_download_document to fetch the file.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      district: z.string(),
      studentId: z.string(),
    },
  }, async (args) => {
    const data = await client.request(args.district, `/campus/api/portal/parents/documents?personID=${encodeURIComponent(args.studentId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
```

- [ ] **Step 4: Register in `src/index.ts`**, run `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/documents.ts tests/tools/documents.test.ts src/index.ts
git commit -m "feat(tools): ic_list_documents"
```

---

### Task 22: `ic_download_document`

**Files:**
- Modify: `src/tools/documents.ts`
- Modify: `tests/tools/documents.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ic_download_document', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ic-doc-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('calls client.download with the document URL and destinationPath', async () => {
    const client = new ICClient(accounts);
    vi.spyOn(client, 'download').mockResolvedValue({
      path: join(dir, 'r.pdf'), bytes: 100, contentType: 'application/pdf',
    });
    setup(client);

    const result = await handlers.get('ic_download_document')!({
      district: 'anoka',
      documentId: '/campus/x.pdf',
      destinationPath: join(dir, 'r.pdf'),
    });

    expect(client.download).toHaveBeenCalledWith('anoka', '/campus/x.pdf', join(dir, 'r.pdf'), { overwrite: false });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ bytes: 100, contentType: 'application/pdf' });
  });

  it('passes overwrite:true through', async () => {
    const client = new ICClient(accounts);
    vi.spyOn(client, 'download').mockResolvedValue({
      path: 'p', bytes: 1, contentType: 'application/pdf',
    });
    setup(client);
    await handlers.get('ic_download_document')!({
      district: 'anoka', documentId: '/x', destinationPath: '/p', overwrite: true,
    });
    expect(client.download).toHaveBeenCalledWith('anoka', '/x', '/p', { overwrite: true });
  });
});
```

You'll also need to add `beforeEach` to the imports at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Add tool to `src/tools/documents.ts`** (inside `registerDocumentTools`)

```ts
server.registerTool('ic_download_document', {
  description: "Download a student's document (PDF) to disk. documentId is the downloadUrl returned by ic_list_documents.",
  annotations: { destructiveHint: true },
  inputSchema: {
    district: z.string(),
    documentId: z.string().describe('The downloadUrl from ic_list_documents'),
    destinationPath: z.string().describe('Absolute path where the PDF should be written'),
    overwrite: z.boolean().default(false).optional(),
  },
}, async (args) => {
  const meta = await client.download(args.district, args.documentId, args.destinationPath, {
    overwrite: args.overwrite ?? false,
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(meta, null, 2) }] };
});
```

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/documents.ts tests/tools/documents.test.ts
git commit -m "feat(tools): ic_download_document"
```

---

## Phase 8 — Coverage gate + release scaffolding

### Task 23: Verify coverage hits 100%

- [ ] **Step 1: Run coverage**

Run: `npx vitest run --coverage`
Expected: 100% lines/functions/branches/statements across `src/` (excluding `src/index.ts`).

- [ ] **Step 2: If anything is below 100%, add targeted tests for the uncovered branches and re-run.**

The most likely gaps will be in `src/client.ts` error branches (e.g. PortalUnreachable paths). Add tests as needed.

- [ ] **Step 3: Commit any added tests**

```bash
git add tests/
git commit -m "test: bring coverage to 100%"
```

---

### Task 24: Write `README.md` and `CLAUDE.md`

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal). Multi-district support (parent of kids in different districts can query and act across all from one MCP).

## Tools

| Domain | Tools |
|---|---|
| Districts | `ic_list_districts` |
| Students | `ic_list_students` |
| Schedule | `ic_get_schedule` |
| Assignments | `ic_list_assignments` (with `missingOnly`) |
| Grades | `ic_list_grades` |
| Attendance | `ic_list_attendance` |
| Behavior | `ic_list_behavior` |
| Food service | `ic_list_food_service` |
| Documents | `ic_list_documents`, `ic_download_document` |
| Messages | `ic_list_messages`, `ic_get_message`, `ic_list_message_recipients`, `ic_send_message` |

## Configuration

Set numbered env vars per district (loader scans `IC_1_*`, `IC_2_*`, … until it hits a gap):

```
IC_1_NAME=anoka
IC_1_BASE_URL=https://anoka.infinitecampus.org
IC_1_DISTRICT=anoka
IC_1_USERNAME=parent@example.com
IC_1_PASSWORD=...
```

See `.env.example`.

## Status

This project was developed and is maintained by AI (Claude). Use at your own discretion. Unofficial — not affiliated with Infinite Campus.
```

- [ ] **Step 2: Write `CLAUDE.md`** (mirrors ofw-mcp's structure)

```markdown
# infinitecampus-mcp

MCP server for Infinite Campus Campus Parent portal — multi-district read + message/document write.

## Build & Test

\`\`\`bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
\`\`\`

`dist/bundle.js` is committed (it's the npm-published artifact). Always rebuild before committing.

## Versioning

Version appears in three places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing
3. `src/index.ts` → `McpServer` constructor `version` field

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning is handled by the **Cut & Bump** GitHub Action.

## Architecture

- `src/index.ts` — MCP server setup, tool routing
- `src/config.ts` — multi-district env loader (`IC_N_*`)
- `src/client.ts` — `ICClient` with per-district session pool, lazy login, 401 retry, download
- `src/tools/` — one file per domain. Each exports `register<Domain>Tools(server, client)`
- `tests/tools/` — mirrors `src/tools/`, mocks `ICClient.request` via `vi.spyOn`

## IC Notes

- Parent portal uses Spring Security session cookies (`JSESSIONID`); login via `/campus/verify.jsp?nonBrowser=true&...`
- Sessions expire ~6h; client uses 5h TTL with 401-retry as backup
- Many districts disable optional modules (behavior, food service); tools return `{warning: 'FeatureDisabled', ...}` on 404 for those endpoints
- Endpoint paths verified against `schwartzpub/ic_parent_api`; revisit when IC ships portal updates
- Multi-district: every tool takes `district` as first arg; `ic_list_districts` returns valid names
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README and CLAUDE.md"
```

---

### Task 25: Add `manifest.json` and `.claude-plugin/plugin.json`

**Files:**
- Create: `manifest.json`
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Write `manifest.json`** (mcpb manifest)

```json
{
  "dxt_version": "0.1",
  "name": "infinitecampus-mcp",
  "version": "0.1.0",
  "description": "Infinite Campus (Campus Parent) MCP — multi-district",
  "author": { "name": "Claude Code (AI)" },
  "server": {
    "type": "node",
    "entry_point": "dist/bundle.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/bundle.js"],
      "env": {
        "IC_1_NAME": "${user_config.ic_1_name}",
        "IC_1_BASE_URL": "${user_config.ic_1_base_url}",
        "IC_1_DISTRICT": "${user_config.ic_1_district}",
        "IC_1_USERNAME": "${user_config.ic_1_username}",
        "IC_1_PASSWORD": "${user_config.ic_1_password}"
      }
    }
  },
  "user_config": {
    "ic_1_name": { "type": "string", "title": "District 1 nickname", "required": true },
    "ic_1_base_url": { "type": "string", "title": "District 1 base URL (https://...)", "required": true },
    "ic_1_district": { "type": "string", "title": "District 1 app name", "required": true },
    "ic_1_username": { "type": "string", "title": "District 1 username", "required": true },
    "ic_1_password": { "type": "string", "title": "District 1 password", "required": true, "sensitive": true }
  }
}
```

(Additional districts can be configured by users via env vars; the manifest exposes the first as the minimum.)

- [ ] **Step 2: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "infinitecampus-mcp",
  "version": "0.1.0",
  "description": "Infinite Campus Campus Parent MCP server (multi-district)",
  "mcp_servers": {
    "infinitecampus": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/bundle.js"]
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json .claude-plugin/plugin.json
git commit -m "chore: add mcpb manifest and Claude plugin descriptor"
```

---

## Self-Review (run before handoff)

**Spec coverage:**
- ✅ `config.ts` — Tasks 3, 4
- ✅ `client.ts` (sessions, request, login, 401 retry, concurrent dedup, download, error classes) — Tasks 5–8
- ✅ All 13 tools (districts, students, schedule, assignments, grades, attendance, behavior, foodservice, documents x2, messages x4) — Tasks 9, 10, 12–22
- ✅ FeatureDisabled fallback for behavior + foodservice — Tasks 16, 17
- ✅ InvalidRecipient validation for ic_send_message — Task 20
- ✅ Path-safety errors for ic_download_document — Task 8 (client) + Task 22 (tool)
- ✅ Tests at all 3 layers (config, client, tools) — every task includes tests
- ✅ 100% coverage gate — Task 23
- ✅ README + CLAUDE.md — Task 24
- ✅ mcpb manifest + plugin descriptor — Task 25

**Placeholder scan:** No "TBD" / "TODO" / "implement later". The implementer is told to read `ic_parent_api` for endpoint paths because those genuinely cannot be invented; the test-first structure ensures any wrong path will fail tests immediately.

**Type consistency:** `Account`, `ICClient`, `Session`, `RequestOpts`, all error classes referenced consistently across tasks. `register<Domain>Tools(server, client)` shape uniform. `client.request(district, path, opts?)` and `client.download(district, path, dest, opts?)` signatures stable from Task 6 onward.

**Out-of-scope confirmation:** Cut & Bump GitHub Action workflow is intentionally not in this plan — copy from ofw-mcp once the project is functional and we want releases. Same with the SKILL.md skill description.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-15-infinitecampus-mcp.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
