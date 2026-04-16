# infinitecampus-mcp

MCP server for Infinite Campus Campus Parent portal — single-account config with CUPS auto-discovery of linked districts.

## Build & Test

```bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

`dist/bundle.js` is committed (it's the npm-published artifact). Always rebuild before committing.

## Versioning

Version appears in three places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing
3. `src/index.ts` → `McpServer` constructor `version` field

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning will be handled by a Cut & Bump GitHub Action (modeled after ofw-mcp's, not yet added here).

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
