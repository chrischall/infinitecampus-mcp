import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, findStudent, studentNotFound } from './_shared.js';

interface RawTerm {
  termID: number;
  termName: string;
  startDate: string;
  endDate: string;
  structureID: number;
  seq: number;
}

interface RawInstructionalDay {
  date: string;
  requiresAttendance: boolean;
  comments: string | null;
}

interface TrimmedDay {
  date: string;
  requiresAttendance: boolean;
  comments?: string;
}

interface TrimmedTerm {
  termID: number;
  termName: string;
  startDate: string;
  endDate: string;
  days: TrimmedDay[];
}

interface CalendarByEnrollment {
  enrollmentID: number;
  calendarID: number;
  structureID: number;
  calendarName?: string;
  terms: TrimmedTerm[];
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
  since: z.string().describe('YYYY-MM-DD; include only days on or after this date').optional(),
  until: z.string().describe('YYYY-MM-DD; include only days on or before this date').optional(),
});

export function registerCalendarTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_school_days', {
    description:
      "List a student's school days (instructional calendar) grouped by term. Returns one entry per enrollment, with term boundaries (Q1-Q4 start/end dates) and the school days inside each term — including comments like 'Teacher Workday' or 'Spring Break'. Use since/until to narrow the range.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    // 1. Get student to find their enrollment(s) → calendarID + structureID
    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const result: CalendarByEnrollment[] = [];

    // 2. For each enrollment, fetch terms + instructional days
    for (const enr of student.enrollments ?? []) {
      const [terms, days] = await Promise.all([
        client.request<RawTerm[]>(args.district, `/campus/resources/term?structureID=${enr.structureID}`),
        client.request<RawInstructionalDay[]>(args.district, `/campus/resources/calendar/instructionalDay?calendarID=${enr.calendarID}`),
      ]);

      // 3. Filter days by since/until range
      const filteredDays = days.filter((d) => {
        if (args.since && d.date < args.since) return false;
        if (args.until && d.date > args.until) return false;
        return true;
      });

      // 4. Group days into terms (only terms in this structureID; sorted by seq)
      const enrollmentTerms = terms
        .filter((t) => t.structureID === enr.structureID)
        .sort((a, b) => a.seq - b.seq);

      const trimmedTerms: TrimmedTerm[] = enrollmentTerms
        .map((t) => ({
          termID: t.termID,
          termName: t.termName,
          startDate: t.startDate,
          endDate: t.endDate,
          days: filteredDays
            .filter((d) => d.date >= t.startDate && d.date <= t.endDate)
            .map((d) => {
              const out: TrimmedDay = { date: d.date, requiresAttendance: d.requiresAttendance };
              if (d.comments) out.comments = d.comments;
              return out;
            }),
        }))
        // Drop empty terms (term entirely outside the since/until range)
        .filter((t) => t.days.length > 0 || (!args.since && !args.until));

      result.push({
        enrollmentID: enr.enrollmentID,
        calendarID: enr.calendarID,
        structureID: enr.structureID,
        calendarName: enr.calendarName,
        terms: trimmedTerms,
      });
    }

    return textContent(result);
  });
}
