import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

interface RawEnrollment {
  enrollmentID: number;
  calendarID: number;
  structureID: number;
  calendarName: string;
}

interface RawStudent {
  personID: number;
  enrollments?: RawEnrollment[];
}

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

interface AttendanceEntry {
  date: string;
  sectionPlacements?: RawSectionPlacement[] | TrimmedSectionPlacement[];
  [key: string]: unknown;
}

interface RawCourse {
  absentList?: AttendanceEntry[];
  tardyList?: AttendanceEntry[];
  presentList?: AttendanceEntry[];
  earlyReleaseList?: AttendanceEntry[];
  [key: string]: unknown;
}

interface RawTerm {
  courses?: RawCourse[];
  [key: string]: unknown;
}

interface RawAttendanceEnrollment {
  terms?: RawTerm[];
  [key: string]: unknown;
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().describe('YYYY-MM-DD').optional(),
  until: z.string().describe('YYYY-MM-DD').optional(),
});

function inRange(date: string | undefined, since?: string, until?: string): boolean {
  if (typeof date !== 'string') return true;
  const d = date.substring(0, 10);
  if (since && d < since) return false;
  if (until && d > until) return false;
  return true;
}

function trimSectionPlacement(sp: RawSectionPlacement | TrimmedSectionPlacement): TrimmedSectionPlacement {
  const out: TrimmedSectionPlacement = {};
  if (sp.periodName !== undefined) out.periodName = sp.periodName;
  if (sp.startTime !== undefined) out.startTime = sp.startTime;
  if (sp.endTime !== undefined) out.endTime = sp.endTime;
  return out;
}

function trimEntry(e: AttendanceEntry): AttendanceEntry {
  if (!Array.isArray(e.sectionPlacements)) return e;
  const sps: (RawSectionPlacement | TrimmedSectionPlacement)[] = e.sectionPlacements;
  return { ...e, sectionPlacements: sps.map(trimSectionPlacement) };
}

function processList(list: AttendanceEntry[] | undefined, since?: string, until?: string): AttendanceEntry[] | undefined {
  if (!list) return list;
  return list.filter((e) => inRange(e.date, since, until)).map(trimEntry);
}

export function registerAttendanceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_attendance', {
    description: "List a student's absences and tardies (per-course summary grouped by term). Auto-resolves enrollmentID from the student record.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const students = await client.request<RawStudent[]>(args.district, '/campus/api/portal/students');
    const student = students.find((s) => String(s.personID) === args.studentId);
    if (!student) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StudentNotFound', studentId: args.studentId }, null, 2) }] };
    }

    const enrollments = student.enrollments ?? [];
    const results: RawAttendanceEnrollment[] = [];

    try {
      for (const enr of enrollments) {
        const data = await client.request<RawAttendanceEnrollment | RawAttendanceEnrollment[]>(
          args.district,
          `/campus/resources/portal/attendance/${enr.enrollmentID}?courseSummary=true&personID=${encodeURIComponent(args.studentId)}`,
        );
        const entries = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          const trimmedTerms = (entry.terms ?? []).map((t) => ({
            ...t,
            courses: (t.courses ?? []).map((c) => ({
              ...c,
              absentList: processList(c.absentList, args.since, args.until),
              tardyList: processList(c.tardyList, args.since, args.until),
              presentList: processList(c.presentList, args.since, args.until),
              earlyReleaseList: processList(c.earlyReleaseList, args.since, args.until),
            })),
          }));
          results.push({ ...entry, terms: trimmedTerms });
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC 404 ')) {
        const warn = { warning: 'FeatureDisabled', feature: 'attendance', district: args.district, data: [] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
