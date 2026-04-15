# Infinite Campus MCP — Design

**Date:** 2026-04-15
**Status:** Approved (brainstorming complete, ready for implementation plan)

## Goal

A Node.js MCP server that exposes the Campus Parent portal of Infinite Campus to
Claude. Read access to the full parent-facing surface (students, schedules,
grades, attendance, assignments, behavior, food service, documents, messages),
plus message composition and document download. Multi-district from day one — a
parent with kids in two or three different districts can query and act across
all of them from one MCP instance.

## Non-goals

- Student-portal authentication (architecture leaves the door open; v1 ships
  parent only).
- Food-service payments, account creation, or any flow that touches money.
- Live integration tests in CI (no shared test districts/credentials exist).
- Cross-district fan-out tools (the LLM calls per-district tools N times; the
  MCP doesn't try to merge results internally).
- PDF rendering or in-context document content (downloads write to disk; LLM
  receives metadata only).

## References

No Infinite Campus MCP exists. Three unofficial libraries serve as protocol
references:

- **Primary:** [schwartzpub/ic_parent_api](https://github.com/schwartzpub/ic_parent_api)
  (Python) — cleanest map of parent-portal endpoints, auth sequence, response
  shapes. Backs a Home Assistant integration.
- **Secondary:** [tonyzimbinski/infinite-campus](https://github.com/tonyzimbinski/infinite-campus)
  (Node) — useful for request-level patterns (cookie jar, login form). Targets
  student portal, so endpoint paths differ.
- **Tertiary:** [gilesgc/Infinite-Campus-API](https://github.com/gilesgc/Infinite-Campus-API)
  (Python) — cross-check for ambiguous endpoints.

## Architecture

Mirrors the [ofw-mcp](https://github.com/chrischall/ofw-mcp) repo layout
exactly, with one new module (`config.ts`) for multi-account support.

```
infinitecampus-mcp/
├── src/
│   ├── index.ts              # MCP server setup, registers all tool modules
│   ├── config.ts             # loads IC_N_* env vars → Account[]
│   ├── client.ts             # ICClient: per-district session pool, request/retry, auth
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
├── tests/
│   ├── config.test.ts
│   ├── client.test.ts
│   ├── fixtures/             # sanitized JSON captures from real portals
│   └── tools/                # one file per tool module
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── manifest.json
├── .claude-plugin/
├── skills/ic/
└── CLAUDE.md
```

### Stack

Same as ofw-mcp:

- TypeScript (ESM), bundled by esbuild
- `@modelcontextprotocol/sdk` for the MCP server + stdio transport
- `zod` for tool input schemas
- `dotenv` for local dev
- `vitest` for tests
- Cut & Bump GitHub Action for releases (matches ofw-mcp's release flow)

### Key architectural decisions

1. **`config.ts` is new vs ofw-mcp.** Loops `IC_1_*…IC_N_*` (scanning until a
   gap is hit) and produces a typed `Account[]`. Fails fast at process start
   for any malformed account.
2. **`ICClient` owns a `Map<districtName, Session>`.** One cookie jar per
   district. Lazy login on first request. Re-login once on 401.
3. **Student-auth door left open.** `ICClient` accepts a `role: 'parent' |
   'student'` internally; v1 hardcodes `'parent'`. The two roles use different
   path prefixes (`/parents/` vs `/students/`); a small adapter in the client
   switches them. Tool signatures stay unchanged when student support is added.
4. **Tool files follow ofw-mcp shape exactly.** Each exports
   `register<Domain>Tools(server, client)`, which calls `server.tool(...)` with
   zod schemas.

## Components

### `config.ts`

```ts
export interface Account {
  name: string;          // IC_N_NAME — used as the `district` arg in tools (must be unique)
  baseUrl: string;       // IC_N_BASE_URL — e.g. https://anoka.infinitecampus.org
  district: string;      // IC_N_DISTRICT — district app-name in URL paths
  username: string;      // IC_N_USERNAME
  password: string;      // IC_N_PASSWORD
}

export function loadAccounts(env = process.env): Account[];
```

Behavior:
- Scans `IC_1_*`, `IC_2_*`… until it finds a gap.
- Initial release supports up to 3 accounts naturally; the loader scales to N.
- Throws on partial accounts, duplicate names, invalid `https://` URLs, or
  zero accounts configured.

### `client.ts`

```ts
interface Session {
  cookieJar: string;     // serialized cookie header
  loggedInAt: number;    // epoch ms; force re-login after ~6h
}

export class ICClient {
  constructor(accounts: Account[]);
  request<T>(district: string, path: string, opts?: RequestOpts): Promise<T>;
  download(district: string, path: string, destinationPath: string,
           opts?: { overwrite?: boolean }): Promise<{ path: string; bytes: number; contentType: string }>;
  listDistricts(): { name: string; baseUrl: string }[];
}
```

Behavior:
- Cookie jar is a simple `Map<cookieName, value>` serialized to a header
  (matches ofw-mcp; no external jar lib).
- Login: GET login page → POST credentials → capture `JSESSIONID`. Sequence
  derived from `ic_parent_api`.
- 401 on data request → re-login once, retry the original request once.
  Second 401 surfaces as `SessionExpired`.
- Concurrent requests to the same district share a single in-flight login
  promise (no double-login race).
- Unknown district arg throws a structured error listing configured names.

### Tool surface

Every tool takes `district: string` as its first arg.

| Tool | Additional args |
|---|---|
| `ic_list_districts` | — |
| `ic_list_students` | — |
| `ic_get_schedule` | `studentId`, `date?` (default today), `termFilter?` |
| `ic_list_assignments` | `studentId`, `courseId?`, `since?`, `until?`, `missingOnly?` |
| `ic_list_grades` | `studentId`, `termId?` |
| `ic_list_attendance` | `studentId`, `since?`, `until?` |
| `ic_list_messages` | `folder?` (inbox/sent), `page?`, `size?` |
| `ic_get_message` | `messageId` |
| `ic_list_message_recipients` | `studentId` — teachers + counselors messageable for that student |
| `ic_send_message` | `recipientIds[]`, `subject`, `body`, `studentId?` |
| `ic_list_behavior` | `studentId`, `since?`, `until?` |
| `ic_list_food_service` | `studentId`, `since?`, `until?` |
| `ic_list_documents` | `studentId` — metadata only: `{id, type, date, downloadUrl}[]` |
| `ic_download_document` | `documentId`, `destinationPath`, `overwrite?` — writes PDF to disk |

Note: `ic_send_message` and `ic_download_document` are write/IO tools. They
will be gated by the harness's standard explicit-permission flow ("sending
messages on behalf of the user", "downloading any file"). No special MCP-side
code is required for that — exposing the tool is sufficient.

## Data flow

Typical read tool call:

```
LLM invokes ic_list_assignments(district="anoka", studentId="12345", missingOnly=true)
      │
      ▼
tool handler in src/tools/assignments.ts
      │ zod validates args
      ▼
client.request("anoka", "/campus/api/portal/parents/assignments?studentId=12345")
      │
      ├─ lookup Account for "anoka"
      │     └─ if unknown → throw "Unknown district 'anoka'. Configured: [...]"
      │
      ├─ lookup Session for "anoka"
      │     └─ if none or stale → login flow, capture JSESSIONID
      │
      ├─ send GET with cookie
      │     └─ if 401 → re-login once, retry
      │
      ▼
raw JSON typed as unknown
      │ handler trims to documented shape, applies missingOnly filter
      ▼
MCP content block: { content: [{ type: "text", text: JSON.stringify(trimmed) }] }
```

Decisions:
- **Sessions are lazy + per-district.** Querying only Anoka never touches
  Minneapolis. Process restart resets all sessions.
- **Response trimming lives in tool handlers, not the client.** Client returns
  raw `unknown`; each tool owns its output shape. Mirrors ofw-mcp.
- **No cross-district fan-out.** LLM calls tools N times when it needs N
  districts. Keeps semantics simple and debuggable.
- **`ic_download_document` bypasses JSON trimming.** `client.download()`
  streams the response body to `destinationPath`, returns
  `{path, bytes, contentType}`.

## Error handling

Three tiers with distinct shapes.

### Tier 1 — Startup (fail fast, exit non-zero)

`config.ts` throws at process start for:

| Cause | Message shape |
|---|---|
| No `IC_1_*` vars set | "No Infinite Campus accounts configured. Set IC_1_NAME, IC_1_BASE_URL, IC_1_DISTRICT, IC_1_USERNAME, IC_1_PASSWORD (and IC_2_*, IC_3_* for more)." |
| Partial account | "Account IC_2 is incomplete: missing PASSWORD. Required vars: NAME, BASE_URL, DISTRICT, USERNAME, PASSWORD." |
| Duplicate `IC_N_NAME` | "Duplicate district name 'anoka' in IC_1 and IC_3. Names must be unique." |
| Invalid `BASE_URL` | "IC_2_BASE_URL is not a valid https URL: '...'" |

### Tier 2 — Per-request (returned as MCP tool errors, recoverable)

| Cause | Result shape |
|---|---|
| Unknown district arg | `{ error: "UnknownDistrict", message, availableDistricts }` |
| Login failed (creds) | `{ error: "AuthFailed", district, hint }` |
| Portal unreachable | `{ error: "PortalUnreachable", district, status, body? }` |
| 401 after re-login retry | `{ error: "SessionExpired", district }` |
| 404 | `{ error: "NotFound", resource, id }` |
| District feature disabled | `{ warning: "FeatureDisabled", feature, district, data: [] }` (success result, empty data) |
| Unexpected response shape | `{ error: "UnexpectedResponse", district, path, zodIssues }` |

### Tier 3 — Write tools

| Cause | Behavior |
|---|---|
| `destinationPath` is a directory | `{ error: "InvalidPath", message }` |
| Parent directory missing | `{ error: "ParentDirectoryMissing", path }` (no implicit mkdir) |
| File exists | `{ error: "FileExists", path, hint }` (override with `overwrite: true`) |
| `ic_send_message` with invalid recipient IDs | `{ error: "InvalidRecipient", invalidIds, validIds }` |

Cross-cutting rule: errors always include `district` when district-scoped.

## Testing

Three layers, vitest, mirrors ofw-mcp.

### `tests/config.test.ts`
Pure tests of `loadAccounts(env)`. Covers happy path, gap-stops-scan, every
Tier-1 error, secrets-not-logged.

### `tests/client.test.ts`
`vi.spyOn(globalThis, 'fetch')` returns canned responses. Covers:
- First request triggers login; second reuses cookie
- 401 triggers re-login + retry; second 401 surfaces `SessionExpired`
- Concurrent requests to same district share single in-flight login
- Two districts in parallel: independent cookie jars
- `download()` streams to file, returns metadata

### `tests/tools/*.test.ts`
One file per domain. Mocks `ICClient.request` via `vi.spyOn(client, 'request')`.
Per tool:
- Args validate (≥1 happy + ≥1 invalid)
- Client called with expected district + path + query params
- Response trimmed to documented shape
- Feature-disabled case where applicable
- Write tools: relevant error paths

### Fixtures
`tests/fixtures/*.json` — sanitized real-portal captures, anonymized.
Regeneration is a manual one-off script, not run in CI.

### Excluded
- No live integration tests in CI (no public test districts; creds shouldn't
  live in CI).
- No end-to-end MCP protocol tests (SDK is trusted; tested at handler level).

### Coverage bar
Match ofw-mcp: every tool handler + every client branch + every config error
path. Every public function has at least one test.

## Open questions

None — all design decisions resolved during brainstorming.

## Out of scope for v1, candidates for v2+

- Student-portal auth (adapter slot reserved in `ICClient`)
- `ic_mark_message_read`
- `ic_add_funds` to food service (real money, payment auth)
- Push-style change notifications (would require IC websocket support, which
  doesn't exist in the parent portal)
- A cross-district aggregator tool (e.g. `ic_list_all_assignments`) — only
  add if LLM fan-out proves to be a real friction point in practice
