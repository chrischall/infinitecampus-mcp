# Registry submissions — infinitecampus-mcp

Ready-to-paste copy for registries that need a manual browser-form submission. Automated pipelines fire on every `v*` tag via `.github/workflows/release.yml`.

## Coverage matrix

| Registry                          | Automated?                               | Where |
| --- | --- | --- |
| npm                               | ✅ `release.yml`                          | `npm publish --provenance` |
| GitHub Releases                   | ✅ `release.yml`                          | `.skill` + `.mcpb` attached |
| modelcontextprotocol/registry     | ✅ `release.yml` (OIDC)                   | `mcp-publisher publish` using `server.json` |
| PulseMCP                          | ✅ transitive (auto-ingests weekly)       | — |
| ClawHub (OpenClaw)                | ✅ conditional on `CLAWHUB_TOKEN`         | `clawhub skill publish` |
| mcpservers.org                    | ❌ manual — [mcpservers.org/submit](https://mcpservers.org/submit) | |
| Anthropic community plugins       | ❌ manual — [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission) | |

## mcpservers.org

- **Server Name:** `infinitecampus-mcp`
- **Short Description:** `Infinite Campus (Campus Parent) MCP server for Claude — grades, attendance, assignments, messages, and documents via natural language`
- **Link:** `https://github.com/chrischall/infinitecampus-mcp`
- **Category:** `Productivity`
- **Contact Email:** `chris.c.hall@gmail.com`

## Anthropic community plugins

- **Repo URL:** `https://github.com/chrischall/infinitecampus-mcp`
- **Plugin name:** `infinitecampus-mcp`
- **Short description:** `Infinite Campus (Campus Parent) MCP server for Claude — grades, attendance, assignments, messages, and documents via natural language`
- **Category:** Productivity
- **Tags:** infinite-campus, campus-parent, school, education, k12, grades, attendance, mcp
