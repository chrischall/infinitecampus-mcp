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
  index.ts             # MCP server entry — loadDotenvSafely + runMcp (both from
                       #   @chrischall/mcp-utils): registers all tools, stdio transport, graceful shutdown
  auth.ts              # resolveAuth(): two-path priority (env vars → fetchproxy fallback). Pattern A template
  config.ts            # loadAccount() — IC_* env loader over mcp-utils readEnvVar.
                       #   IC_BASE_URL+IC_DISTRICT required;
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

`loadAccount()` trims whitespace and treats blanks, the literals `undefined`/`null`, and unsubstituted `${FOO}` placeholders as missing (via mcp-utils' `readEnvVar`) — protects against MCP hosts passing `.mcp.json` env blocks through unexpanded. `.env` is loaded at process start by `loadDotenvSafely` (mcp-utils; forces dotenv's `quiet: true` since stdout is reserved for JSON-RPC). Partial creds (one of IC_USERNAME/IC_PASSWORD set without the other) are treated as a user mistake and throw rather than falling through to fetchproxy — masking typos would be worse than failing loudly.

Linked districts (parent has kids in 2+ IC instances under the same SSO) are added dynamically by `ICClient.discoverLinkedDistricts()` after primary login — no extra config. For truly separate credentials, run two MCP instances. In fetchproxy mode, discovery runs lazily on the first primary-district request (since `login()` is skipped).

## Auth resolution (Pattern A template)

`src/auth.ts` is the canonical "browser-bootstrap + Node-direct" shape used across our MCP family (ofw-mcp, resy-mcp, opentable-mcp, zola-mcp, signupgenius-mcp, …). Two paths, priority order:

1. **Env-var credentials** (`IC_USERNAME` + `IC_PASSWORD` + `IC_BASE_URL` + `IC_DISTRICT`) → `loadAccount()` returns a full Account; `ICClient.login()` POSTs to `verify.jsp` exactly as before. Unchanged from pre-fetchproxy behavior.
2. **fetchproxy fallback** → `@fetchproxy/bootstrap` opens a one-shot WebSocket bridge to the extension, reads `JSESSIONID` (HttpOnly, via `chrome.cookies.get`) + `XSRF-TOKEN` from a signed-in IC portal tab, closes the bridge. The client gets pre-loaded cookies in place of running `verify.jsp`. All subsequent IC calls go out via plain Node `fetch()` — fetchproxy is NOT in the request hot path. Bridge errors are classified via `@chrischall/mcp-utils/fetchproxy` (`classifyBridgeError` / `FetchproxyBridgeDownError`) into actionable messages.

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

<!-- pr-workflow:v2 -->
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

**Exception for first-party dependency bumps.** When bumping a package we own (currently `@fetchproxy/bootstrap` — anything published from a chrischall-owned repo), label the PR `enhancement` or `bug` instead of `dependencies`, and use the matching commit prefix (`feat:` or `fix:`) instead of `chore:`. Those bumps deliver real product fixes or features through us, so they should drive a release-please version bump and show up under Features/Bug Fixes in the release notes — not get hidden under "Dependencies" (which doesn't trigger a release).

The **PR title MUST be a Conventional Commit**, written user-facing (`fix(scope): …`, `feat(scope): …`), not internal shorthand. Because the repo squash-merges, the PR title *becomes the squash commit's subject line* — the only thing release-please parses to pick the version bump and changelog section. Only `feat` (minor), `fix` (patch), and `!`/`BREAKING CHANGE` (major) cut a release; `perf`/`refactor`/`docs` show in the changelog without bumping; `ci`/`test`/`build`/`chore` are recognised but hidden (see `release-please-config.json` → `changelog-sections`). A title without a conventional type is invisible to release-please — no bump, no changelog line. Prefixes in *individual commits* don't help; squash keeps only the title.

### How PRs merge

**Don't run `gh pr merge` yourself.** The automation does it:

1. `pr-auto-review.yml` runs a Claude review on every PR **except** the release-please release PR (which it deliberately skips). A `pass` **or** `warn` verdict adds the `ready-to-merge` label; `warn`/`fail` also open or update an `auto-review-followup` issue capturing the findings. Only a `fail` verdict blocks the merge.
2. `auto-merge.yml`, on the `ready-to-merge` label (or on a dependabot PR), arms `gh pr merge --auto --squash`. The moment CI is green the PR squash-merges itself.

For ordinary feature/fix PRs, opening with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a release-notes line) is the whole job. If Claude's verdict was `warn`/`fail` but you've decided to ship anyway, add the label yourself: `gh pr edit <num> --add-label ready-to-merge`.

### Auto-review follow-up issues

When a PR's auto-review verdict is `warn` or `fail`, the `chrischall/workflows` pipeline opens or updates a single `auto-review-followup` issue ("Auto-review follow-ups for PR #N") whose checklist captures every finding, and links it from the PR's `<!-- auto-review-verdict -->` comment (`📋 Tracking follow-ups: #N`). `warn` (nits only) still auto-merges — the issue carries the nits forward, so most nits are fixed in a *later* PR; `fail` blocks until the important findings are addressed on the PR itself.

When asked to address the auto-review comments / review findings on a PR:

1. Read the verdict comment, open the linked `auto-review-followup` issue, and treat its checklist as the work list (alongside any inline review comments).
2. Resolve each item, checking off only what you've **verified** is genuinely fixed.
3. If every item is resolved on the current PR, add `Closes #<issue>` to that PR's body so the merge closes it; if some are deferred, check off only the resolved ones and leave the issue open.
4. For nits whose `warn` PR already auto-merged, address them in a follow-up PR that references `Closes #<issue>`.

(Mirrors the fleet-wide convention in `~/.claude/CLAUDE.md`.)

### PR timing — only open when the feature is done

Because PRs auto-merge as soon as auto-review passes, **do not open a PR until the feature is genuinely complete**. There's no draft-PR safety net here:

- Don't open a PR to "stage" work while live verification, follow-up fixes, or final passes are still pending — by the time you finish those, the half-baked PR may already be in `main`.
- Push commits to the branch first; only run `gh pr create` once tests pass, live verification (if applicable) is green, and you'd be comfortable with the change shipping as-is.
- If follow-ups land after a PR is already open, they need to land on the same branch *before* auto-review flips to `pass`. Once the PR squash-merges, late commits orphan onto a stale branch and become their own follow-up PR.
- If you genuinely need a checkpoint review without shipping, open the PR as a GitHub draft (`gh pr create --draft …`) — auto-review skips drafts. Mark it ready-for-review only when the feature is truly done.

**Release PRs are the one manual touch.** release-please opens its own release PR and leaves it open as your staging artifact — `pr-auto-review.yml` skips it on purpose, so it sits there accumulating changes until you decide to ship. When you're ready, add `ready-to-merge` to it the same way: `gh pr edit <num> --add-label ready-to-merge`. The `auto-merge.yml` arm then takes over and the publish job fires the moment the release PR lands.

The repo allows squash-merge only — `--merge` and `--rebase` are blocked at the branch-protection ruleset level.

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422 (`validation failed: expected length <= 100, location: body.description`). The other description fields (`manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) have no published length constraint and can stay longer.

Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

## Versioning

The version string lives in several files, **all kept in sync by release-please** — don't edit them by hand:

1. `package.json` → `"version"` + `package-lock.json` (the `node` release-type updates both)
2. `src/index.ts` → `version: '…'` on the `COMMON` const, marked `// x-release-please-version` (extra-file)
3. `manifest.json` → `"version"` (extra-file)
4. `server.json` → top-level `"version"` and `packages[*].version` (extra-files)
5. `.claude-plugin/plugin.json` → `"version"` (extra-file)
6. `.claude-plugin/marketplace.json` → `metadata.version` and `plugins[*].version` (extra-files)

(See `release-please-config.json` → `extra-files`.) `tests/version-sync.test.ts` enforces that every `x-release-please-version` annotation in `src/` matches `package.json` — add that marker to any new version-bearing constant.

### Release flow

Commits land on `main` via PR. release-please (`.github/workflows/release-please.yml`) opens or updates a `chore(main): release X.Y.Z` PR whenever Conventional-Commit messages (`feat:`, `fix:`, etc.) accumulate. Merging the release PR (arm `ready-to-merge`) creates the tag and a GitHub Release; the `publish` job then packs `.mcpb` + `.skill`, publishes to npm with provenance, and pushes to the MCP Registry.

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. release-please owns versioning.

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
