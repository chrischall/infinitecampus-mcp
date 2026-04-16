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

interface AttendanceEntry {
  date: string;
  sectionPlacements?: RawSectionPlacement | RawSectionPlacement[] | TrimmedSectionPlacement | TrimmedSectionPlacement[];
  [key: string]: unknown;
}

interface RawCourse {
  absentList?: AttendanceEntry | AttendanceEntry[];
  tardyList?: AttendanceEntry | AttendanceEntry[];
  presentList?: AttendanceEntry | AttendanceEntry[];
  earlyReleaseList?: AttendanceEntry | AttendanceEntry[];
  [key: string]: unknown;
}

interface RawTerm {
  courses?: RawCourse | RawCourse[];
  [key: string]: unknown;
}

interface RawAttendanceEnrollment {
  terms?: RawTerm | RawTerm[];
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
  if (e.sectionPlacements === undefined) return e;
  const sps = toArray<RawSectionPlacement | TrimmedSectionPlacement>(e.sectionPlacements);
  return { ...e, sectionPlacements: sps.map(trimSectionPlacement) };
}

function processList(list: AttendanceEntry | AttendanceEntry[] | undefined, since?: string, until?: string): AttendanceEntry[] | undefined {
  if (list === undefined) return list;
  return toArray(list).filter((e) => inRange(e.date, since, until)).map(trimEntry);
}

export function registerAttendanceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_attendance', {
    description: "List a student's absences and tardies (per-course summary grouped by term). Auto-resolves enrollmentID from the student record.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const enrollments = student.enrollments ?? [];
    const results: RawAttendanceEnrollment[] = [];

    try {
      for (const enr of enrollments) {
        const data = await client.request<RawAttendanceEnrollment | RawAttendanceEnrollment[]>(
          args.district,
          `/campus/resources/portal/attendance/${enr.enrollmentID}?courseSummary=true&personID=${encodeURIComponent(args.studentId)}`,
        );
        const entries = toArray(data);
        for (const entry of entries) {
          const trimmedTerms = toArray(entry.terms).map((t) => ({
            ...t,
            courses: toArray(t.courses).map((c) => ({
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
      return textContent(results);
    } catch (e) {
      if (is404(e)) return featureDisabled('attendance', args.district);
      throw e;
    }
  });
}
