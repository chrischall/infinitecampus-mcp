---
name: ic
description: This skill should be used when the user asks about Infinite Campus (Campus Parent portal) data for their kids. Triggers on phrases like "check IC", "Infinite Campus", "what's my kid's grade", "any missing assignments", "school messages", "report card", "lunch balance", or any request about a student's schedule, grades, attendance, behavior, food service, documents, or portal messages. Multi-district: a parent of kids in different districts can query and act across all of them from one MCP instance.
---

# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal) — read student schedules, grades, assignments, attendance, behavior, food service, documents, and portal messages across one or more districts.

- **Source:** `github.com/<owner>/infinitecampus-mcp` (placeholder — package not yet published)

## Setup

### Option A — Claude Code (direct MCP, no mcporter)

Add to `.mcp.json` in your project or `~/.claude/mcp.json`. Districts are numbered (`IC_1_*`, `IC_2_*`, …); the loader scans sequentially until a gap:

```json
{
  "mcpServers": {
    "ic": {
      "command": "npx",
      "args": ["-y", "infinitecampus-mcp"],
      "env": {
        "IC_1_NAME": "Springfield",
        "IC_1_BASE_URL": "https://campus.springfield.k12.example.us",
        "IC_1_DISTRICT": "springfield",
        "IC_1_USERNAME": "you@example.com",
        "IC_1_PASSWORD": "yourpassword"
      }
    }
  }
}
```

To add more districts, append `IC_2_NAME`, `IC_2_BASE_URL`, `IC_2_DISTRICT`, `IC_2_USERNAME`, `IC_2_PASSWORD`, then `IC_3_*`, etc. The loader stops at the first missing number.

### Option B — mcporter

#### 1. Install

```bash
npm install -g infinitecampus-mcp
```

Or from source:
```bash
git clone https://github.com/<owner>/infinitecampus-mcp
cd infinitecampus-mcp
npm install && npm run build
```

#### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env: set IC_1_NAME, IC_1_BASE_URL, IC_1_DISTRICT, IC_1_USERNAME, IC_1_PASSWORD
# Add IC_2_*, IC_3_*, ... for additional districts
```

#### 3. Register with mcporter

```bash
mcporter config add ic \
  --command "infinitecampus-mcp" \
  --env "IC_1_NAME=Springfield" \
  --env "IC_1_BASE_URL=https://campus.springfield.k12.example.us" \
  --env "IC_1_DISTRICT=springfield" \
  --env "IC_1_USERNAME=you@example.com" \
  --env "IC_1_PASSWORD=yourpassword" \
  --config ~/.mcporter/mcporter.json
```

#### 4. Verify

```bash
mcporter list --config ~/.mcporter/mcporter.json
mcporter call ic.ic_list_districts --config ~/.mcporter/mcporter.json
```

## Calling tools (mcporter)

```bash
mcporter call ic.<tool_name> [key=value ...] --config ~/.mcporter/mcporter.json
```

Always pass `--config ~/.mcporter/mcporter.json` unless a local `config/mcporter.json` exists.

Every tool except `ic_list_districts` takes `district` as its first arg (the district name from `ic_list_districts`). Most student-scoped tools also take `studentId` (the personID from `ic_list_students`).

## Tools

### Districts & Students
| Tool | Notes |
|------|-------|
| `ic_list_districts` | Lists configured districts. Call this first — other tools need the `district` name. |
| `ic_list_students(district)` | Lists students (kids) attached to the portal account for a district. Use the `personID` for `studentId` on other tools. |

### Academics
| Tool | Notes |
|------|-------|
| `ic_get_schedule(district, studentId)` | Today's class schedule by default. |
| `ic_list_assignments(district, studentId, courseId?, since?, until?, missingOnly?)` | Pass `missingOnly=true` to see only missing/late work across all courses. |
| `ic_list_grades(district, studentId, termId?)` | Grades summary. Omit `termId` for all terms. |

### Daily life
| Tool | Notes |
|------|-------|
| `ic_list_attendance(district, studentId, since?, until?)` | Absences/tardies with dates. |
| `ic_list_behavior(district, studentId, since?, until?)` | Returns a `FeatureDisabled` warning if the district has no behavior module enabled — this is not an error. |
| `ic_list_food_service(district, studentId, since?, until?)` | Lunch balance and transactions. Same `FeatureDisabled` fallback as behavior. |

### Documents
| Tool | Notes |
|------|-------|
| `ic_list_documents(district, studentId)` | Metadata only (report cards, transcripts, etc.). |
| `ic_download_document(district, studentId, documentId, destinationPath)` | Writes the PDF to `destinationPath` on disk. **`destinationPath` is required** — confirm the path with the user before calling. |

### Messages
| Tool | Notes |
|------|-------|
| `ic_list_messages(district, folder?, page?, size?)` | `folder` is `inbox` or `sent`. Paginated. |
| `ic_get_message(district, messageId)` | Full message body. |
| `ic_list_message_recipients(district)` | Valid recipient IDs (teachers, staff) for this district. Call before `ic_send_message` to validate recipients. |
| `ic_send_message(district, subject, body, recipientIds[])` | **Sends a real message through the portal.** Recipients must come from `ic_list_message_recipients` — made-up IDs will fail. |

## Workflows

**Discovery (first time):**
1. `ic_list_districts` → see configured districts
2. For each district: `ic_list_students(district)` → collect kids and personIDs

**Are my kids OK?**
1. `ic_list_assignments(district, studentId, missingOnly=true)` for each kid
2. `ic_list_grades(district, studentId)` for a current snapshot
3. `ic_list_attendance(district, studentId, since=<recent>)` for recent absences

**Today's schedule:**
- `ic_get_schedule(district, studentId)` — returns today's classes by default

**Email a teacher:**
1. `ic_list_message_recipients(district)` → find the teacher's recipient ID
2. Draft subject/body with the user and confirm
3. `ic_send_message(district, subject, body, [teacherRecipientId])`

**Get the report card:**
1. `ic_list_documents(district, studentId)` → find the report card's `documentId`
2. Confirm destination path with the user
3. `ic_download_document(district, studentId, documentId, destinationPath="/Users/.../report-card.pdf")`

## Caution

- `ic_send_message` actually sends a portal message to teachers/staff — always confirm subject, body, and recipients with the user before calling.
- `ic_download_document` writes a PDF to disk at `destinationPath` — confirm the path with the user; overwrites silently.
- Endpoint behavior varies by district. If `ic_list_behavior` or `ic_list_food_service` returns a `FeatureDisabled` warning, that module is simply turned off for the district — it's not an error.
