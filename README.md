# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal). Single-account config — linked districts are auto-discovered via CUPS SSO after login.

## Tools

| Domain | Tools |
|---|---|
| Districts | `ic_list_districts` |
| Students | `ic_list_students` |
| Schedule | `ic_get_schedule` |
| Assignments | `ic_list_assignments` (with `missingOnly` filter) |
| Grades | `ic_list_grades` |
| Attendance | `ic_list_attendance` |
| Behavior | `ic_list_behavior` |
| Food service | `ic_list_food_service` |
| Documents | `ic_list_documents`, `ic_download_document` |
| Notifications | `ic_list_messages` (prism notifications), `ic_get_message` (unread count) |

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

Linked districts (via CUPS SSO) are auto-discovered after login — no extra config needed. If you have truly separate IC instances with different credentials, run two MCP instances.

See `.env.example`.

## Status

This project was developed and is maintained by AI (Claude). Use at your own discretion. Unofficial — not affiliated with Infinite Campus.
