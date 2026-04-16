---
name: ic
description: This skill should be used when the user asks about Infinite Campus (Campus Parent portal) data for their kids. Triggers on phrases like "check IC", "Infinite Campus", "what's my kid's grade", "any missing assignments", "school messages", "report card", "lunch balance", or any request about a student's schedule, grades, attendance, behavior, food service, documents, or portal messages. Linked districts are auto-discovered via CUPS SSO.
---

# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal) — read student schedules, grades, assignments, attendance, behavior, food service, documents, and portal messages. Linked districts are auto-discovered via CUPS SSO after primary login.

- **Source:** [github.com/chrischall/infinitecampus-mcp](https://github.com/chrischall/infinitecampus-mcp)
- **npm:** [npmjs.com/package/infinitecampus-mcp](https://www.npmjs.com/package/infinitecampus-mcp)

## Setup

### Option A — Claude Code (direct MCP, no mcporter)

Add to `.mcp.json` in your project or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "ic": {
      "command": "npx",
      "args": ["-y", "infinitecampus-mcp"],
      "env": {
        "IC_BASE_URL": "https://campus.springfield.k12.example.us",
        "IC_DISTRICT": "springfield",
        "IC_USERNAME": "you@example.com",
        "IC_PASSWORD": "yourpassword",
        "IC_NAME": "Springfield"
      }
    }
  }
}
```

Linked districts (via CUPS SSO) are auto-discovered after login — no extra config needed. `IC_NAME` is optional and defaults to `IC_DISTRICT`.

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
# Edit .env: set IC_BASE_URL, IC_DISTRICT, IC_USERNAME, IC_PASSWORD
# IC_NAME is optional (defaults to IC_DISTRICT)
```

#### 3. Register with mcporter

```bash
mcporter config add ic \
  --command "infinitecampus-mcp" \
  --env "IC_BASE_URL=https://campus.springfield.k12.example.us" \
  --env "IC_DISTRICT=springfield" \
  --env "IC_USERNAME=you@example.com" \
  --env "IC_PASSWORD=yourpassword" \
  --env "IC_NAME=Springfield" \
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
| `ic_list_districts` | Lists configured districts (primary + any CUPS-linked). Call this first — other tools need the `district` name. |
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
| `ic_list_documents(district, studentId)` | Metadata only (report cards, transcripts, etc.). Returns `FeatureDisabled` if the district has the documents module turned off. |
| `ic_download_document(district, documentId, destinationPath)` | Writes the PDF to `destinationPath` on disk. **`destinationPath` is required** — confirm the path with the user before calling. Returns `FeatureDisabled` if unavailable. |

### Notifications
| Tool | Notes |
|------|-------|
| `ic_list_messages(district, limit?)` | Portal notifications (district announcements, teacher messages, system alerts) via prism notification system. |
| `ic_get_message(district)` | Unread notification/message count. |

## Workflows

**Discovery (first time):**
1. `ic_list_districts` → see configured + linked districts
2. For each district: `ic_list_students(district)` → collect kids and personIDs

**Are my kids OK?**
1. `ic_list_assignments(district, studentId, missingOnly=true)` for each kid
2. `ic_list_grades(district, studentId)` for a current snapshot
3. `ic_list_attendance(district, studentId, since=<recent>)` for recent absences

**Today's schedule:**
- `ic_get_schedule(district, studentId)` — returns today's classes by default

**Get the report card:**
1. `ic_list_documents(district, studentId)` → find the report card's `documentId`
2. Confirm destination path with the user
3. `ic_download_document(district, studentId, documentId, destinationPath="/Users/.../report-card.pdf")`

## Caution

- `ic_download_document` writes a PDF to disk at `destinationPath` — confirm the path with the user; overwrites silently.
- Endpoint behavior varies by district. If `ic_list_behavior`, `ic_list_food_service`, `ic_list_documents`, or `ic_download_document` returns a `FeatureDisabled` warning, that module is simply turned off for the district — it's not an error.
