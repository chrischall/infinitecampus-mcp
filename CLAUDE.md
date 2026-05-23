# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal). Single-account config; linked districts are auto-discovered via CUPS SSO after primary login. Stdio transport, 19 tools across academics, daily life, documents, and messaging.

## Commands

```bash
npm run build        # tsc → dist/ + esbuild bundle → dist/bundle.js
npm run bundle       # esbuild only (skip tsc)
npm run dev          # node --env-file=.env dist/index.js (requires built dist/)
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

`dist/` is gitignored; CI rebuilds it and npm publish ships it via the `files` array in `package.json`. Rebuild locally before publishing or verifying end-to-end.

## Tool naming

All tools are prefixed `ic_` (e.g. `ic_list_grades`, `ic_get_schedule`). Every per-student tool takes `district` as its first arg; use `ic_list_districts` to get valid names.

## Architecture

```
src/
  index.ts             # MCP server entry — registers all tools, stdio transport
  auth.ts              # resolveAuth(): two-path priority (env vars → fetchproxy fallback). Pattern A template
  config.ts            # loadAccount() — IC_* env loader. IC_BASE_URL+IC_DISTRICT required;
                       #   IC_USERNAME+IC_PASSWORD optional (both or neither — partial = error)
  client.ts            # ICClient — per-district session pool, lazy login, 401 retry,
                       #   CUPS linked-district discovery, download(). Accepts preloaded cookies
  tools/
    _shared.ts         # textContent, findStudent, featureDisabled, checkFeatureDisabled,
                       #   is404, toArray — shared MCP shape + 404/feature-flag helpers
    districts.ts       # ic_list_districts
    students.ts        # ic_list_students
    schedule.ts        # ic_get_schedule
    assignments.ts     # ic_list_assignments
    grades.ts          # ic_list_grades
    recent_grades.ts   # ic_list_recent_grades (default 14d window)
    attendance.ts      # ic_list_attendance (per-course summary)
    attendance_events.ts # ic_list_attendance_events
    calendar.ts        # ic_list_school_days
    behavior.ts        # ic_list_behavior (FeatureDisabled-aware)
    foodservice.ts     # ic_list_food_service (FeatureDisabled-aware)
    messages.ts        # ic_list_messages, ic_get_message
    documents.ts       # ic_list_documents, ic_download_document
    teachers.ts        # ic_list_teachers
    assessments.ts     # ic_list_assessments
    fees.ts            # ic_list_fees
    features.ts        # ic_get_features
tests/                 # vitest — mirrors src/ layout; mocks ICClient.request / .download
docs/endpoints.md      # IC endpoint inventory (discovered vs. shipped)
```

Each `tools/*.ts` exports `register<Domain>Tools(server, client)`. Tool schemas use the `argsSchema = z.object({...})` const pattern: the SDK receives `argsSchema.shape`, the handler runs `argsSchema.parse(rawArgs)` — single source of truth that also stays safe when handlers are invoked from unit tests outside the MCP request path.

## Environment

```
IC_BASE_URL=https://campus.<district>.k12.example.us  # https only, required (both auth paths)
IC_DISTRICT=<appName>                                 # district appName path segment, required (both auth paths)
IC_USERNAME=<parent username>                         # optional (set with IC_PASSWORD for password login)
IC_PASSWORD=<parent password>                         # optional (set with IC_USERNAME for password login)
IC_NAME=<friendly name>                               # optional, defaults to IC_DISTRICT
IC_DISABLE_FETCHPROXY=1                               # optional, "1|true|yes|on" → skip fetchproxy fallback
```

`loadAccount()` trims whitespace and treats blanks, the literals `undefined`/`null`, and unsubstituted `${FOO}` placeholders as missing — protects against MCP hosts passing `.mcp.json` env blocks through unexpanded. Loaded via `dotenv` from `.env` at process start (`quiet: true`; stdout is reserved for JSON-RPC). Partial creds (one of IC_USERNAME/IC_PASSWORD set without the other) are treated as a user mistake and throw rather than falling through to fetchproxy — masking typos would be worse than failing loudly.

Linked districts (parent has kids in 2+ IC instances under the same SSO) are added dynamically by `ICClient.discoverLinkedDistricts()` after primary login — no extra config. For truly separate credentials, run two MCP instances. In fetchproxy mode, discovery runs lazily on the first primary-district request (since `login()` is skipped).

## Auth resolution (Pattern A template)

`src/auth.ts` is the canonical "browser-bootstrap + Node-direct" shape used across our MCP family (ofw-mcp, resy-mcp, opentable-mcp, zola-mcp, signupgenius-mcp, …). Two paths, priority order:

1. **Env-var credentials** (`IC_USERNAME` + `IC_PASSWORD` + `IC_BASE_URL` + `IC_DISTRICT`) → `loadAccount()` returns a full Account; `ICClient.login()` POSTs to `verify.jsp` exactly as before. Unchanged from pre-fetchproxy behavior.
2. **fetchproxy fallback** → `@fetchproxy/bootstrap` (0.3.0+) opens a one-shot WebSocket bridge to the extension, reads `JSESSIONID` (HttpOnly, via `chrome.cookies.get`) + `XSRF-TOKEN` from a signed-in IC portal tab, closes the bridge. The client gets pre-loaded cookies in place of running `verify.jsp`. All subsequent IC calls go out via plain Node `fetch()` — fetchproxy is NOT in the request hot path.

CUPS linked-district token-minting still happens entirely in Node — it just needs the primary district's cookies (which fetchproxy provides on bootstrap). On a 401 or TTL expiry in fetchproxy mode, the client refuses to attempt `verify.jsp` (empty creds) and throws an actionable error telling the user to re-sign-in in the browser and restart the MCP.

`@fetchproxy/bootstrap` is mocked at the module boundary in `tests/auth.test.ts`. Existing tool tests don't import it — they exercise `ICClient` directly.

## Testing

Tests live under `tests/` mirroring `src/`. Run with `npm test`. No real API calls — `ICClient.request` (and `ICClient.download` for `documents`) are mocked via `vi.spyOn`.

`vitest.config.ts` enforces **100% lines/functions/branches/statements** on `src/**` excluding `src/index.ts` (the stdio entry point). Adding a new tool or branch requires tests to keep CI green.

## Plugin / Marketplace / Registry

```
.claude-plugin/plugin.json       # Claude Code plugin manifest (skill + .mcp.json ref)
.claude-plugin/marketplace.json  # Marketplace catalog entry
.mcp.json                        # Plugin-runtime MCP server config (uses ${CLAUDE_PLUGIN_ROOT})
manifest.json                    # MCPB / DXT bundle manifest (user_config + tool catalog)
server.json                      # modelcontextprotocol/registry entry
SKILL.md                         # Claude Code skill — when/how to use the tools
skills/ic/SKILL.md               # Packaged .skill file (zipped in Release workflow)
```

None of these are part of the MCP runtime — they exist for distribution (Claude Code plugin marketplace, MCPB, MCP Registry, ClawHub).

<!-- pr-workflow:v1 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
| `enhancement`        | Features                 |
| `bug`                | Bug Fixes                |
| `security`           | Security                 |
| `refactor`           | Refactor                 |
| `documentation`      | Documentation            |
| `test`               | Tests                    |
| `dependencies`       | Dependencies             |
| `ci` / `github_actions` | CI & Build            |
| *(none / unmatched)* | Other Changes            |
| `ignore-for-release` | Hidden from notes        |

The **PR title** becomes the bullet — write it like a user-facing changelog entry (`ic_list_grades: include in-progress course grades`), not internal shorthand (`grades tweaks`). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422 (`validation failed: expected length <= 100, location: body.description`). The other description fields (`manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) have no published length constraint and can stay longer.

Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

## Versioning

Version appears in SEVEN places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing (or `npm version` does it)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`
5. `server.json` → top-level `"version"` and `packages[].version`
6. `.claude-plugin/plugin.json` → `"version"`
7. `.claude-plugin/marketplace.json` → `metadata.version` and `plugins[].version`

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning is handled by the **Tag & Bump** GitHub Action (`.github/workflows/tag-and-bump.yml`).

### Release workflow

Main is always one version ahead of the latest tag. To release, run **Tag & Bump** (workflow_dispatch) which:

1. Reuses `ci.yml` (build + test)
2. Tags the current commit with the current version
3. `npm version patch` + a node script that walks every JSON version field, plus a `sed` on `src/index.ts`
4. Verifies the build, commits `chore: bump version to vX.Y.Z`, pushes main + tag

The tag push triggers `.github/workflows/release.yml`: rebuild, sync version files, package `.skill`, build `.mcpb`, `npm publish --provenance`, publish to the MCP Registry, optionally publish the skill to ClawHub, and create a GitHub Release with auto-generated notes.

## Gotchas

- **ESM + NodeNext**: imports must use `.js` extensions even for `.ts` source files (e.g. `import { loadAccount } from './config.js'`).
- **stdio transport**: the server logs to **stderr only** — stdout is reserved for JSON-RPC. `dotenv` is loaded with `quiet: true` for the same reason; any extra stdout output corrupts the stream.
- **Per-district session pool**: `ICClient` keeps one `Session` per district (cookie + XSRF token). `ensureSession` deduplicates concurrent logins via `loginInFlight`. Mutate sessions in place — concurrent callers hold live references.
- **Session TTL**: 5h (`SESSION_TTL_MS`), slightly under IC's ~6h. `doRequest` does a single 401-retry: on 401 for a linked district, ALL sessions are invalidated and the primary is re-logged-in so CUPS rediscovers.
- **Login auth state**: `verify.jsp` returns 200 with `<AUTHENTICATION>state</AUTHENTICATION>` — `password-error`, `account-locked`, etc. The body is parsed and surfaced as an `AuthFailedError` with the reason, not a generic failure.
- **Cookie jar**: IC's login response sends ~20 Set-Cookie headers including deletion markers (`Max-Age=0`). `parseSetCookies` filters those out and dedupes by name — sending both delete and set forms (e.g. `appName=`) makes IC reject the request with "conflicting app name values".
- **FeatureDisabled**: many districts disable modules (behavior, food service, assessments). Tools probe `checkFeatureDisabled` against the per-structure `displayOptions` allow-list first, then fall through with an `is404` backstop — both paths return `{warning: 'FeatureDisabled', feature, district, data: []}` instead of throwing.
- **Features cache**: `getFeatures` caches per `(district, structureID)` for the session TTL — flags rarely change mid-session.
- **`ic_download_document`** is the only write/IO tool (writes to disk). It does pre-flight checks for directory destinations, missing parent dir, and existing files (requires `overwrite: true`). Supports absolute URLs as well as relative `/campus/...` paths.
- **Endpoint discovery**: paths are derived from `schwartzpub/ic_parent_api` (Python). When IC ships portal updates, check that repo first. `docs/endpoints.md` tracks every discovered endpoint and whether it's shipped.
