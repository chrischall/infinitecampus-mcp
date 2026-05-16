# infinitecampus-mcp

MCP server for Infinite Campus Campus Parent portal — single-account config with CUPS auto-discovery of linked districts.

## Build & Test

```bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

`dist/` is gitignored; the bundle is built fresh by CI and ships via npm (per the `files` array in `package.json`). Rebuild locally with `npm run build` before publishing or when verifying a change end-to-end.

## Versioning

Version appears in three places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing
3. `src/index.ts` → `McpServer` constructor `version` field

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Version bumps happen in their own commits at the end of a release cycle (current: v2.0.x).

## Architecture

- `src/index.ts` — MCP server setup, tool routing
- `src/config.ts` — single-account env loader (`IC_BASE_URL`, `IC_DISTRICT`, `IC_USERNAME`, `IC_PASSWORD`, optional `IC_NAME`)
- `src/client.ts` — `ICClient` with per-district session pool, lazy login, 401 retry, download method. Constructor takes a single `Account`; linked districts are added dynamically via CUPS SSO discovery.
- `src/tools/` — one file per domain. Each exports `register<Domain>Tools(server, client)`. Tool schemas use the `argsSchema = z.object({...})` const pattern: SDK gets `argsSchema.shape`, handler does `args = argsSchema.parse(rawArgs)`. This gives us a single source of truth for the schema and runtime safety in case the handler is invoked outside of the MCP request path (e.g., direct unit-test call).
- `tests/tools/` — mirrors `src/tools/`, mocks `ICClient.request` (or `ICClient.download` for documents) via `vi.spyOn`

## Coverage

`vitest.config.ts` enforces 100% lines/functions/branches/statements across `src/` (excluding `src/index.ts`, the stdio entry point). Adding a new tool or branch requires a test to keep CI green.

## IC Notes

- Parent portal uses Spring Security session cookies (`JSESSIONID`); login flow is `POST /campus/verify.jsp?nonBrowser=true&...`
- Sessions expire ~6h; client uses 5h TTL with 401-retry as a backup
- Many districts disable optional modules (behavior, food service); tools for those return `{warning: 'FeatureDisabled', ...}` on 404 instead of throwing
- Endpoint paths in this repo are derived from `schwartzpub/ic_parent_api` (Python). When IC ships portal updates, that repo is the first place to check for new patterns
- Single-account config: `loadAccount()` reads flat `IC_*` env vars. CUPS SSO auto-discovers linked districts after primary login, adding them dynamically to the client's account/session maps. Every tool takes `district` as its first arg; `ic_list_districts` returns valid names (primary + any linked).

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

The **PR title** becomes the bullet — write it like a user-facing changelog entry, not internal shorthand. Conventional-commit prefixes are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.
