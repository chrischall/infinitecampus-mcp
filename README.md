# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal). Single-account config — linked districts are auto-discovered via CUPS SSO after login.

## Tools

19 tools across academics, daily life, documents, messaging, and feature discovery.

| Domain | Tools |
|---|---|
| Districts | `ic_list_districts` |
| Students | `ic_list_students` |
| Schedule | `ic_get_schedule` |
| Assignments | `ic_list_assignments` (sectionID server-side; `missingOnly` / date filters client-side) |
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

## Configuration

Set a single set of env vars for your primary Infinite Campus account:

```
IC_BASE_URL=https://campus.springfield.k12.example.us
IC_DISTRICT=springfield
IC_USERNAME=parent@example.com
IC_PASSWORD=...
IC_NAME=Springfield           # optional, defaults to IC_DISTRICT
```

Linked districts (via CUPS SSO) are auto-discovered after primary login — a parent with kids in two districts only configures the primary. No extra config needed. If you have truly separate IC instances with different credentials, run two MCP instances.

See `.env.example`.

## Status

Unofficial — not affiliated with Infinite Campus. AI-maintained.
