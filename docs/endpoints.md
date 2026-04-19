# IC Endpoint Coverage

Inventory of every Infinite Campus endpoint we've discovered, whether it's wired into an MCP tool, and why/why not. Updated whenever a new endpoint is probed or a tool is added/removed.

Sources for discovery:
- Live browser sniffing on Springfield (Springfield HS) and Westside Academy
- `schwartzpub/ic_parent_api` (Python reference library)
- `tonyzimbinski/infinite-campus` (Node reference library)
- `gilesgc/Infinite-Campus-API` (Python reference library)

Status legend: ✅ shipped · 🚧 planned · ⏸️ deferred · 🚫 skipped · ❓ unknown

---

## Shipped tools (current MCP surface)

| Tool | Endpoint | Notes |
|---|---|---|
| `ic_list_districts` | (internal — config + CUPS discovery) | Includes linked districts auto-discovered via CUPS |
| `ic_list_students` | `GET /campus/api/portal/students` | ✅ Confirmed working both districts |
| `ic_get_schedule` | `GET /campus/resources/portal/roster?personID=X` | ✅ Returns courses with section placements |
| `ic_list_assignments` | `GET /campus/api/portal/assignment/listView?personID=X[&sectionID=Y]` | ✅ `sectionID` is the only server-side filter; date/state filters are ignored by the server so we apply client-side |
| `ic_list_grades` | `GET /campus/resources/portal/grades?personID=X[&termID=Y]` | ✅ |
| `ic_list_school_days` | `GET /campus/api/portal/students` + `/campus/resources/term?structureID=X` + `/campus/resources/calendar/instructionalDay?calendarID=Y` | ✅ Grades-shaped: enrollment → terms → days |
| `ic_list_attendance` | `GET /campus/resources/portal/attendance/{enrollmentID}?courseSummary=true&personID=X` | ✅ Auto-resolves enrollmentID from `ic_list_students`. Returns per-course/term summary with absent/tardy/present/earlyRelease lists. Trims lists by since/until client-side. Each list entry's `sectionPlacements` is trimmed to `{ periodName, startTime, endTime }` (the parent course already carries the rest). Short-circuits via `displayOptions.attendance` when disabled. |
| `ic_list_attendance_events` | `GET /campus/resources/portal/attendance/events?enrollmentID=X&personID=X` | ✅ Individual absence/tardy events with code, description, excuse, human comments. Auto-resolves enrollmentID; supports since/until/excusedOnly filters. Each event's `sectionPlacements` is trimmed to `{ periodName, startTime, endTime }`. Short-circuits via `displayOptions.attendance` when disabled. |
| `ic_list_behavior` | `GET /campus/resources/portal/behavior?personID=X` | ⚠️ Unknown real path; short-circuits via `displayOptions.behavior` when disabled, 404 backstop otherwise |
| `ic_list_food_service` | `GET /campus/resources/portal/foodService?personID=X` | ⚠️ Unknown real path; short-circuits via `displayOptions.foodService` when disabled, 404 backstop otherwise |
| `ic_list_documents` | `GET /campus/resources/portal/report/all?personID=X` | ✅ Returns document metadata (name, type, url, moduleLabel, endYear). Use `url` field with `ic_download_document`. Short-circuits via `displayOptions.documents` when disabled. |
| `ic_download_document` | (client download to disk using `url` from `ic_list_documents`) | ✅ |
| `ic_list_recent_grades` | `GET /campus/api/portal/assignment/recentlyScored?modifiedDate=ISO&personID=X` | ✅ Recently-scored assignments. Takes `since` (YYYY-MM-DD), defaults to 14 days ago. |
| `ic_list_teachers` | `GET /campus/resources/portal/section/contacts?personID=X` + `GET /campus/resources/portal/studentCounselor/byUser?personID=X` | ✅ Combined teachers (per enrolled section) + counselors. 404 on either sub-endpoint is treated as empty list. |
| `ic_list_messages` | `GET /campus/prism?x=notifications.Notification-retrieve&limitCount=N` + `GET /campus/api/portal/process-message` + `GET /campus/resources/portal/userNotice` | ✅ Combines three sources: prism notifications (assignment/grade/attendance alerts), Messenger 2.0 inbox (teacher messages, district announcements), and portal userNotice announcements. `limit` caps prism only (high-volume source). Per-section `error` field if any source fails. Listing is treated as read-only; live probe against an empty inbox could not confirm a read-tracking side effect and the count endpoint the earlier tool used was removed as redundant with the `newMessage` flag already returned here. |
| `ic_get_message` | `GET <messageUrl>` (relative `portal/messageView.xsl?x=messenger.MessengerEngine-getMessageRecipientView&messageID=...&messageRecipientID=...&processMessageID=...` from inbox items, normalized to absolute `/campus/...`) | ✅ Fetches the HTML body of an inbox message and parses into `{ subject, date, body, url }`. Strips `<script>`/`<style>` blocks, strips tags, decodes common HTML entities, collapses whitespace, splits on the "Date: MM/DD/YYYY" line. Treated as `readOnlyHint: true`; probe against an empty inbox could not confirm whether fetching the body marks the message as read — some district configurations may do so. |
| `ic_list_assessments` | `GET /campus/resources/prism/portal/assessments?personID=X&calendarID=Y` | ✅ Standardized test scores (stateTests, nationalTests, districtTests). Auto-resolves calendarID per enrollment; loops through all enrollments. Drops `assessmentHTML`. Short-circuits via `displayOptions.assessment` when disabled; 404 on every enrollment → FeatureDisabled backstop. |
| `ic_get_features` | `GET /campus/api/portal/displayOptions/{structureID}?personID=X` | ✅ Returns the district's ~90-flag allow-list per enrollment (attendance, behavior, assessment, documents, grades, schedule, academicPlanner, etc.). Results cached per (district, structureID) for the session TTL. Used internally by `ic_list_behavior`, `ic_list_food_service`, `ic_list_assessments`, `ic_list_attendance`, `ic_list_attendance_events`, and `ic_list_documents` to short-circuit disabled features before hitting the real endpoint — cleaner than 404-catch alone, though 404 remains as a backstop. |
| `ic_list_fees` | `GET /campus/api/portal/fees/feeAssignments?personID=X` + `GET /campus/api/portal/fees/feeTransactionDetail/totalSurplus/-1?personID=X` | ✅ Fee assignments (charges owed) + surplus/balance (raw number). Both endpoints run in parallel. FeatureDisabled only if both 404; partial success returns the working side with top-level `warning: 'PartialSuccess'` and an `issues: string[]` array (parallel to the `warning: 'FeatureDisabled'` shape). |

---

## Planned — new tools

_(none currently)_

---

## Deferred — low priority (situational)

Useful only if a specific kid uses the feature. All would auto-detect via `displayOptions` flags.

| Tool | Endpoint | displayOption flag | Reason deferred |
|---|---|---|---|
| `ic_list_plans` | `GET /campus/api/portal/plan?personID=X&portalHomeOnly=false` | `plan`, `documentsIEP` | IEP/504 plans — only for students in special ed |
| `ic_list_progress_reports` | `GET /campus/api/portal/progressReport?personID=X` | `progressReport` | Teacher commentary reports — varies district-to-district |
| `ic_list_evaluations` | `GET /campus/api/portal/evaluation?personID=X` | `documentsIEP` | Special ed evaluations |
| `ic_list_prior_written_notices` | `GET /campus/api/portal/priorWrittenNotice?personID=X` | `documentsIEP` | Special ed notices |
| `ic_list_forms` | `GET /campus/api/portal/custom-forms/forms?personID=X` | `customForms` | Back-to-school forms, permission slips — mostly one-time |

---

## Skipped — won't implement

| Endpoint | Why skipped |
|---|---|
| `GET /campus/api/portal/hand-raise/list?personID=X` | Campus virtual hand-raise feature. Returned `[]` on both districts — near-zero signal. |
| `GET /campus/api/portal/studentParticipation/attendanceInfo?date=X&personID=X` | Virtual learning check-ins. Data is thin (just `hasCheckIns`, `isVirtual`) and covered by attendance events. |
| `GET /campus/api/portal/requiredActions/portalLogin` | Returns a single boolean `olrRequired` (Online Registration pending). Too narrow for a tool. |
| `GET /campus/api/portal/crossSite/instructionalDay?structureID=X&personID=X` | Cross-site enrollments only (rare). Regular instructionalDay endpoint covers the common case. |
| `GET /campus/resources/portal/dayEvent/byEnrollment?personID=X` | Overlaps heavily with `instructionalDay` (comments already include event labels). |
| Academic Planner (graduation progress) | Uses the legacy prism API style (`portal.PortalAcademicPlanner-*`), Springfield only. Grades tool already shows progress toward term GPAs. |
| `GET /campus/resources/portal/attendance/events` (Messenger 2.0 replies) | No response/reply endpoint discovered that works for parents. Districts route responses through other systems (email, phone, ParentSquare). |

---

## Not yet probed

Candidates to investigate later:
- Transportation / bus routing
- Activities / athletics participation
- Health (immunizations, meds)
- Lockers (we see a `lockers` field in `generalInfo` but haven't pulled the detail)
- Household members / contact preferences

---

## Conventions

- Every tool takes `district: string` as its first arg (even single-district configs use it to scope across CUPS-linked districts).
- Student-scoped tools take `studentId: string` (the `personID` from `ic_list_students`).
- Enrollment-scoped data is resolved inside the tool from `studentId` → student's primary enrollment → `enrollmentID` / `calendarID` / `structureID`.
- When an endpoint is known to be disabled per district, we prefer `displayOptions`-based early return over 404-catch-and-fallback. The 404 fallback remains as a backstop for undetectable cases.
