# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal). Multi-district support — a parent of kids in different districts can query and act across all of them from one MCP instance.

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
| Messages | `ic_list_messages`, `ic_get_message`, `ic_list_message_recipients`, `ic_send_message` |

Tools that the harness will gate as write/IO operations: `ic_send_message`, `ic_download_document`.

## Configuration

Set numbered env vars per district. The loader scans `IC_1_*`, `IC_2_*`, … until it hits a gap, so accounts must be sequential.

```
IC_1_NAME=anoka
IC_1_BASE_URL=https://anoka.infinitecampus.org
IC_1_DISTRICT=anoka
IC_1_USERNAME=parent@example.com
IC_1_PASSWORD=...
```

Add `IC_2_*`, `IC_3_*` for additional districts. See `.env.example`.

## Status

This project was developed and is maintained by AI (Claude). Use at your own discretion. Unofficial — not affiliated with Infinite Campus.
