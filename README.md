# infinitecampus-mcp

[![CI](https://github.com/chrischall/infinitecampus-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/infinitecampus-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/infinitecampus-mcp)](https://www.npmjs.com/package/infinitecampus-mcp)
[![license](https://img.shields.io/npm/l/infinitecampus-mcp)](LICENSE)

MCP server for Infinite Campus (Campus Parent portal). Single-account config — linked districts are auto-discovered via CUPS SSO after login.

## Tools

20 tools across academics, daily life, documents, messaging, feature discovery, and a credential/district healthcheck.

| Domain | Tools |
|---|---|
| Districts | `ic_list_districts` |
| Students | `ic_list_students` |
| Schedule | `ic_get_schedule` |
| Assignments | `ic_list_assignments` (sectionID server-side; `missingOnly` / date filters client-side; name the student as `student: "<name> (<district>)"` or with `district` + `studentId`; `view: "brief"` answers one line per assignment inside the untrusted-data envelope, `-- none` when nothing matches) |
| Grades | `ic_list_grades`, `ic_list_recent_grades` (default 14d window) |
| School calendar | `ic_list_school_days` |
| Attendance | `ic_list_attendance` (per-course summary), `ic_list_attendance_events` (individual events with codes + comments) |
| Behavior | `ic_list_behavior` (FeatureDisabled-aware) |
| Food service | `ic_list_food_service` (FeatureDisabled-aware) |
| Documents | `ic_list_documents`, `ic_download_document` |
| Messaging | `ic_list_messages` (3 sources: prism notifications + Messenger 2.0 inbox + portal announcements), `ic_get_message` (fetch parsed HTML body of an inbox message) |
| Teachers | `ic_list_teachers` (teachers per section + assigned counselors) |
| Assessments | `ic_list_assessments` (standardized test scores) |
| Fees | `ic_list_fees` (assignments + surplus balance) |
| Features | `ic_get_features` (per-enrollment displayOptions flags) |

Tools that the harness will gate as write/IO operations: `ic_download_document`.

`ic_download_document` hands the document back by whichever route reaches you: on a **hosted** server (mcp-host) it returns a signed, expiring download link and writes nothing to the server's disk; on a **local** install it writes to `destinationPath` inside `IC_DOWNLOAD_DIR` (default `~/Downloads`), as before. `inline: true` returns the file in the result instead (up to 10 MiB). Downloads are capped at 50 MB and time out after 2 minutes.

### Context-group hints

Every tool carries a `_meta.mint` hint (domain `school`) that [mcp-host](https://github.com/chrischall/mcp-host) reads to group tools by what they answer. `ic_list_assignments` is the canonical *what's due* tool: its hint names `student` as the subject and `since`/`until` as the date range. At start the server builds the `student` labels — `"<name> (<district>)"` for every student in every linked district — and advertises them as an enum; if that fails or takes longer than 8 seconds, the argument is still advertised without an enum and a label is resolved when the tool is called.

## Configuration

`infinitecampus-mcp` tries two auth paths in priority order; whichever succeeds first is used. Existing setups keep working unchanged.

1. **Env-var credentials (legacy).** Set all four:
   ```
   IC_BASE_URL=https://campus.springfield.k12.example.us
   IC_DISTRICT=springfield
   IC_USERNAME=parent@example.com
   IC_PASSWORD=...
   IC_NAME=Springfield           # optional, defaults to IC_DISTRICT
   ```
2. **ContextMint Bridge fallback (no password needed).** Set only `IC_BASE_URL` + `IC_DISTRICT` (still required so the MCP knows which host to talk to and which district to dispatch on), then install the ContextMint Bridge browser extension from [its releases page](https://github.com/nullnet-app/contextmint-bridge/releases) (Chrome: download the chrome zip and load it unpacked via `chrome://extensions` → Developer mode → Load unpacked; there is no Chrome Web Store listing yet. Safari is not available yet — it will ship inside the ContextMint app, which has no public download — so use Chrome for now) and sign into your IC portal once. ContextMint Bridge is the fetchproxy browser extension under its new name, from the same maintainer — [fetchproxy's own README](https://github.com/chrischall/fetchproxy#extension) points to it. Its source is public at [nullnet-app/contextmint-bridge](https://github.com/nullnet-app/contextmint-bridge): build it yourself, or check a release zip against the `.sha256` file published beside it (`shasum -a 256 -c contextmint-bridge-chrome-<version>.zip.sha256`). The MCP reads the `JSESSIONID` (HttpOnly) + `XSRF-TOKEN` cookies from that tab and goes direct-to-API from Node thereafter — the extension is **not** in the request hot path. The read is repeated whenever the session lapses (JSESSIONID is a servlet session with a short idle timeout), so you stay signed in without restarting the MCP.

Set `IC_DISABLE_FETCHPROXY=1` to opt out of the fallback (turns missing credentials into a hard error — useful in headless CI).

Linked districts (via CUPS SSO) are auto-discovered after primary login — a parent with kids in two districts only configures the primary. No extra config needed. If you have truly separate IC instances with different credentials, run two MCP instances.

See `.env.example`.

## Upgrading

### next release — `ic_download_document` on hosted servers

- `destinationPath` is now **optional**. A local install still requires it unless `inline: true` (the call is refused before anything is fetched); a hosted server ignores everything but its file name.
- New optional `inline` (boolean).
- On a local install without `inline`, the result is unchanged: `{ path, bytes, contentType }`.
- On a hosted server, or with `inline: true`, the result is a different receipt — `{ via, fileName, bytes, contentType, downloadUrl?, downloadExpiresAt?, note? }` — with no `path` (there is no file a caller could open). `via` is `link` (use `downloadUrl` before `downloadExpiresAt`) or `resource` (the file is an embedded-resource content block ahead of the receipt). `contentType` here is the bare media type, without `;charset=…` parameters.
- A hosted server with no blob store, given a document over 10 MiB, refuses with a `too_large` error instead of writing to the runner's disk.

## Status

Unofficial — not affiliated with Infinite Campus. AI-maintained.

## Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses your own Campus Parent account.** Auth happens via your own credentials, scoped to the student records your school district has authorized you to view. It does not — and cannot — access anyone else's student records.

**2. [Infinite Campus's Terms of Use](https://www.infinitecampus.com/terms/terms-of-use) govern your use of this server**, just as they govern your direct use of Campus Parent. The clauses most relevant here:

> Users may not access, use, or search the Services by any means other than our publicly supported interfaces (for example, scraping or using the content to train artificial intelligence software).

And: *"You are responsible for safeguarding the password that you use to access the Service and you agree not to disclose your password to any third party."*

You are agreeing to those terms — read by the maintainer 2026-05-23 — every time you invoke a tool in this server. This server uses Infinite Campus's mobile-app JSON endpoints (`/campus/api/oneRosterCampus`, `/portal/api/...`) which are not "publicly supported interfaces" — IC may treat this as a ToS violation.

**3. Personal, parent/student use only.** This project is not affiliated with, endorsed by, sponsored by, or in partnership with Infinite Campus, Inc. or any school district. It is a personal automation tool for an authorized Campus Parent / Campus Student user to read their own (or their student's) records. **Do not** use it to bulk-extract student data, share another family's grades, or train AI models on student records.

**4. FERPA + COPPA apply.** Student educational records are protected under the federal Family Educational Rights and Privacy Act (FERPA), and student data for under-13 users is additionally covered by COPPA. Even though *your* parent-portal access is lawful, **how you store, redistribute, or feed that data into LLMs is regulated**. Treat any output from this server (grades, attendance, behavior records, schedules) as confidential student data. Do not put it in shared LLM contexts, do not paste it into screenshots, and do not train models on it.

**5. You accept full responsibility** for any consequences of using this server in connection with your Campus Parent account — rate limiting, account warnings, district IT investigations, or any enforcement action your district or Infinite Campus takes. Your district may have additional acceptable-use policies (acceptable-use agreements, parent handbooks) that further restrict automation. If your district or Infinite Campus objects to your use, stop using this server.

This section is the maintainer's good-faith summary of the terms — it is not legal advice and does not modify or supersede Infinite Campus's actual ToU or any school district's policies.
