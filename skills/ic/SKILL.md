---
name: ic
description: This skill should be used when the user asks about Infinite Campus (Campus Parent portal) data for their kids. Triggers on phrases like "check IC", "Infinite Campus", "what's my kid's grade", "any missing assignments", "school messages", "report card", "lunch balance", "recent grades", "assessments", "fees", or any request about a student's schedule, grades, assignments, attendance, behavior, food service, documents, messages, teachers, assessments, or fees. Linked districts are auto-discovered via CUPS SSO.
---

# infinitecampus-mcp

MCP server for Infinite Campus (Campus Parent portal) — 19 tools covering schedule, grades (current + recently-scored), assignments, attendance (summary + per-event), behavior, food service, documents, messages (3 sources), teachers, assessments, and fees. Linked districts are auto-discovered via CUPS SSO after primary login.

- **Source:** [github.com/chrischall/infinitecampus-mcp](https://github.com/chrischall/infinitecampus-mcp)
- **npm:** [npmjs.com/package/infinitecampus-mcp](https://www.npmjs.com/package/infinitecampus-mcp)

## Setup

Single-account config. Set env vars for your primary IC account; linked districts come from CUPS discovery.

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

Only `IC_BASE_URL`, `IC_DISTRICT`, `IC_USERNAME`, `IC_PASSWORD` are required. `IC_NAME` is optional (defaults to `IC_DISTRICT`). Linked districts (via CUPS SSO) are auto-discovered after login — a parent with kids in two districts only configures the primary.

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
| `ic_get_schedule(district, studentId)` | Today's class schedule by default, with section placements. |
| `ic_list_assignments(district, studentId, courseId?, since?, until?, missingOnly?)` | `sectionID` is the only server-side filter; `since`/`until`/`missingOnly` are applied client-side. Pass `missingOnly=true` to see only missing/late work across all courses. |
| `ic_list_grades(district, studentId, termId?)` | Term + in-progress grade summary. Omit `termId` for all terms. |
| `ic_list_recent_grades(district, studentId, since?)` | Recently-scored assignments. Defaults to a 14-day window; pass `since` (YYYY-MM-DD) to widen. |
| `ic_list_assessments(district, studentId)` | Standardized test scores (state/national/district tests). FeatureDisabled-aware. |
| `ic_list_teachers(district, studentId)` | Teachers per enrolled section + assigned counselor(s). |

### Daily life
| Tool | Notes |
|------|-------|
| `ic_list_school_days(district, studentId)` | Instructional calendar with term boundaries. |
| `ic_list_attendance(district, studentId, since?, until?)` | Per-course attendance summary grouped by term. |
| `ic_list_attendance_events(district, studentId, since?, until?, excusedOnly?)` | Individual absence/tardy events with codes and human comments. |
| `ic_list_behavior(district, studentId, since?, until?)` | Returns a `FeatureDisabled` warning if the district has no behavior module enabled — this is not an error. |
| `ic_list_food_service(district, studentId, since?, until?)` | Lunch balance and transactions. Same `FeatureDisabled` fallback as behavior. |
| `ic_list_fees(district, studentId)` | Fee assignments + surplus/balance. Returns `PartialSuccess` if only one endpoint works, `FeatureDisabled` if both 404. |

### Documents
| Tool | Notes |
|------|-------|
| `ic_list_documents(district, studentId)` | Metadata only (report cards, schedules, transcripts). Each item has a `url` to pass to `ic_download_document`. Returns `FeatureDisabled` if the documents module is off. |
| `ic_download_document(district, url, destinationPath)` | Writes the document to `destinationPath` on disk. **`destinationPath` is required** — confirm the path with the user before calling. |

### Messaging
| Tool | Notes |
|------|-------|
| `ic_list_messages(district, limit?)` | Combines three sources: **prism notifications** (grade/attendance/assignment alerts), **Messenger 2.0 inbox** (teacher messages, priority announcements like closures), and **portal userNotice** (district banners). `limit` caps prism only. Per-source `error` field if one fails. |
| `ic_get_message(district, url)` | Fetches and parses the HTML body of an inbox message. Returns `{ subject, date, body, url }`. |

### Features
| Tool | Notes |
|------|-------|
| `ic_get_features(district, studentId)` | Raw per-enrollment `displayOptions` flags (attendance/behavior/assessment/documents/…). Useful for diagnosing why another tool returned `FeatureDisabled`. |

## Workflows

**Discovery (first time):**
1. `ic_list_districts` → see configured + linked districts
2. For each district: `ic_list_students(district)` → collect kids and personIDs

**Is everything OK at school?**
1. `ic_list_districts`
2. For each student:
   - `ic_list_recent_grades(district, studentId)` — last 14 days of scored work
   - `ic_list_attendance_events(district, studentId, excusedOnly=false)` — recent absences/tardies
   - `ic_list_messages(district)` — any alerts from teachers or the district

**What got graded this week?**
- `ic_list_recent_grades(district, studentId, since="YYYY-MM-DD")`

**Check upcoming or missing assignments:**
- `ic_list_assignments(district, studentId, missingOnly=true)` — only the late/missing set
- Or `ic_list_assignments(district, studentId, since=..., until=...)` for a date window

**Today's schedule:**
- `ic_get_schedule(district, studentId)` — returns today's classes by default

**Weather closure or priority announcement?**
- `ic_list_messages(district)` — scan the Messenger 2.0 inbox entries for priority subjects
- `ic_get_message(district, url)` to read a specific one

**Download a report card:**
1. `ic_list_documents(district, studentId)` → find the report card's `url`
2. Confirm destination path with the user
3. `ic_download_document(district, url, destinationPath="/Users/.../report-card.pdf")`

## Caution

- `ic_download_document` writes to disk at `destinationPath` — confirm the path with the user; overwrites silently.
- `ic_list_messages` / `ic_get_message` are nominally read-only, but on some district configurations fetching an inbox message or enumerating the list may mark entries as read. Behavior was not confirmable against an empty test inbox.
- Endpoint behavior varies by district. If `ic_list_behavior`, `ic_list_food_service`, `ic_list_documents`, `ic_list_assessments`, or `ic_list_fees` returns a `FeatureDisabled` warning, that module is simply turned off for the district — it's not an error. `ic_list_fees` may also return `PartialSuccess` when only one of its two sub-endpoints works.
