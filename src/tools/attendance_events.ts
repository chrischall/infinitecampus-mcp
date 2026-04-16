import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, featureDisabled, findStudent, studentNotFound, toArray } from './_shared.js';

interface RawSectionPlacement {
  periodName?: string;
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
}

interface TrimmedSectionPlacement {
  periodName?: string;
  startTime?: string;
  endTime?: string;
}

interface RawEvent {
  attendanceID?: number;
  date?: string;
  localDate?: string;
  code?: string;
  description?: string;
  excuse?: string;
  excuseType?: string;
  comments?: string;
  termID?: number;
  status?: string;
  periodID?: number;
  modifiedDate?: string;
  wholeDayAbsence?: boolean;
  sectionPlacements?: RawSectionPlacement | RawSectionPlacement[];
  [key: string]: unknown;
}

interface RawEnrollmentEvents {
  calendarID?: number;
  calendarName?: string;
  enrollmentID?: number;
  structureID?: number;
  schoolName?: string;
  crossSiteEnrollment?: boolean;
  endDate?: string;
  events?: RawEvent | RawEvent[];
  [key: string]: unknown;
}

interface TrimmedEvent {
  attendanceID?: number;
  date?: string;
  localDate?: string;
  code?: string;
  description?: string;
  excuse?: string;
  excuseType?: string;
  comments?: string;
  termID?: number;
  status?: string;
  periodID?: number;
  modifiedDate?: string;
  wholeDayAbsence?: boolean;
  sectionPlacements?: TrimmedSectionPlacement[];
  [key: string]: unknown;
}

interface TrimmedEnrollmentEvents {
  calendarID?: number;
  calendarName?: string;
  enrollmentID?: number;
  structureID?: number;
  schoolName?: string;
  crossSiteEnrollment?: boolean;
  endDate?: string;
  events: TrimmedEvent[];
  [key: string]: unknown;
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
  since: z.string().describe('YYYY-MM-DD; include only events on or after this date').optional(),
  until: z.string().describe('YYYY-MM-DD; include only events on or before this date').optional(),
  excusedOnly: z.boolean().describe('Only include events with excuse=E').optional(),
});

const EVENT_KEYS: Array<keyof TrimmedEvent> = [
  'attendanceID', 'date', 'localDate', 'code', 'description', 'excuse',
  'excuseType', 'comments', 'termID', 'status', 'periodID', 'modifiedDate',
  'wholeDayAbsence',
];

const ENROLLMENT_KEYS: Array<keyof TrimmedEnrollmentEvents> = [
  'calendarID', 'calendarName', 'enrollmentID', 'structureID', 'schoolName',
  'crossSiteEnrollment', 'endDate',
];

function trimSectionPlacement(sp: RawSectionPlacement): TrimmedSectionPlacement {
  const out: TrimmedSectionPlacement = {};
  if (sp.periodName !== undefined) out.periodName = sp.periodName;
  if (sp.startTime !== undefined) out.startTime = sp.startTime;
  if (sp.endTime !== undefined) out.endTime = sp.endTime;
  return out;
}

function trimEvent(e: RawEvent): TrimmedEvent {
  const out: TrimmedEvent = {};
  for (const key of EVENT_KEYS) {
    const v = e[key];
    if (v !== undefined) out[key] = v;
  }
  if (e.sectionPlacements !== undefined) {
    out.sectionPlacements = toArray(e.sectionPlacements).map(trimSectionPlacement);
  }
  return out;
}

export function registerAttendanceEventsTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_attendance_events', {
    description: "List individual attendance events (absences, tardies, early releases) for a student. Each event has a code, description, excuse reason, and optional human-readable comments. Auto-resolves enrollmentID from the student record. Use since/until to filter by date and excusedOnly to show only excused events.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const enrollments = student.enrollments ?? [];
    const results: TrimmedEnrollmentEvents[] = [];

    try {
      for (const enr of enrollments) {
        const raw = await client.request<RawEnrollmentEvents | RawEnrollmentEvents[]>(
          args.district,
          `/campus/resources/portal/attendance/events?enrollmentID=${enr.enrollmentID}&personID=${encodeURIComponent(args.studentId)}`,
        );
        const entries = toArray(raw);
        for (const entry of entries) {
          const trimmed: TrimmedEnrollmentEvents = { events: [] };
          for (const key of ENROLLMENT_KEYS) {
            const v = entry[key];
            if (v !== undefined) trimmed[key] = v;
          }
          const events = toArray(entry.events).filter((e) => {
            const d = typeof e.localDate === 'string' ? e.localDate.substring(0, 10) : undefined;
            if (args.since && (d === undefined || d < args.since)) return false;
            if (args.until && (d === undefined || d > args.until)) return false;
            if (args.excusedOnly && e.excuse !== 'E') return false;
            return true;
          }).map(trimEvent);
          trimmed.events = events;
          results.push(trimmed);
        }
      }
      return textContent(results);
    } catch (e) {
      if (is404(e)) return featureDisabled('attendance_events', args.district);
      throw e;
    }
  });
}
