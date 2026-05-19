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
  config.ts            # loadAccount() — flat IC_* env loader, https + presence checks
  client.ts            # ICClient — per-district session pool, lazy login, 401 retry,
                       #   CUPS linked-district discovery, download()
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
IC_BASE_URL=https://campus.<district>.k12.example.us  # https only, required
IC_DISTRICT=<appName>                                 # district appName path segment, required
IC_USERNAME=<parent username>                         # required
IC_PASSWORD=<parent password>                         # required
IC_NAME=<friendly name>                               # optional, defaults to IC_DISTRICT
```

`loadAccount()` trims whitespace and treats blanks, the literals `undefined`/`null`, and unsubstituted `${FOO}` placeholders as missing — protects against MCP hosts passing `.mcp.json` env blocks through unexpanded. Loaded via `dotenv` from `.env` at process start (`quiet: true`; stdout is reserved for JSON-RPC).

Linked districts (parent has kids in 2+ IC instances under the same SSO) are added dynamically by `ICClient.discoverLinkedDistricts()` after primary login — no extra config. For truly separate credentials, run two MCP instances.

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
