import { McpServer } from '@modelcontextprotocol/server';
import { viewArg, viewResponse } from '../view.js';
import { z } from 'zod';
import { PortalUnreachableError, type ICClient } from '../client.js';
import { findStudent, is404, studentNotFound, toArray } from './_shared.js';

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
  comments?: string | null;
}

/** calendar/day lists every day on the calendar, instructional or not. */
interface RawCalendarDay extends RawInstructionalDay {
  isInstructionalDay: boolean;
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
  warning?: 'SchoolDaysUnavailable';
  terms: TrimmedTerm[];
}

/** The portal answered, but not with this resource: worth trying another route. */
function isRouteFailure(e: unknown): boolean {
  return e instanceof PortalUnreachableError || is404(e);
}

/**
 * The calendar's instructional days, or null when no route to them answers.
 *
 * Some districts now 500 on calendar/instructionalDay: Campus matches it to
 * calendar/{calendarID} and reads "instructionalDay" as the ID (#253).
 * calendar/day returns the same days plus the non-instructional ones, flagged
 * by isInstructionalDay. Session and auth errors are not route failures and
 * propagate, so a dead session never reads as "days unknown".
 */
async function fetchInstructionalDays(
  client: ICClient,
  district: string,
  calendarID: number,
): Promise<RawInstructionalDay[] | null> {
  try {
    return toArray(await client.request<RawInstructionalDay | RawInstructionalDay[]>(
      district, `/campus/resources/calendar/instructionalDay?calendarID=${calendarID}`));
  } catch (e) {
    if (!isRouteFailure(e)) throw e;
  }
  try {
    const all = toArray(await client.request<RawCalendarDay | RawCalendarDay[]>(
      district, `/campus/resources/calendar/day?calendarID=${calendarID}`));
    return all.filter((d) => d.isInstructionalDay);
  } catch (e) {
    if (!isRouteFailure(e)) throw e;
    return null;
  }
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
      "List a student's school days (instructional calendar) grouped by term. Returns one entry per enrollment, with term boundaries (Q1-Q4 start/end dates) and the school days inside each term — including comments like 'Teacher Workday' or 'Spring Break'. Use since/until to narrow the range. An enrollment whose day list the district won't serve comes back with warning 'SchoolDaysUnavailable', its terms, and no days.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ ...argsSchema.shape, view: viewArg() }),
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    // 1. Get student to find their enrollment(s) → calendarID + structureID
    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const result: CalendarByEnrollment[] = [];

    // 2. For each enrollment, fetch terms + instructional days
    for (const enr of student.enrollments ?? []) {
      const [termsRaw, days] = await Promise.all([
        client.request<RawTerm | RawTerm[]>(args.district, `/campus/resources/term?structureID=${enr.structureID}`),
        fetchInstructionalDays(client, args.district, enr.calendarID),
      ]);
      const terms = toArray(termsRaw);

      // 3. Filter days by since/until range
      const filteredDays = (days ?? []).filter((d) => {
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
        // Drop terms entirely outside the since/until range. With no days to
        // go on, judge a term by whether its own dates overlap the range.
        .filter((t) => days === null
          ? !(args.since && t.endDate < args.since) && !(args.until && t.startDate > args.until)
          : t.days.length > 0 || (!args.since && !args.until));

      result.push({
        enrollmentID: enr.enrollmentID,
        calendarID: enr.calendarID,
        structureID: enr.structureID,
        calendarName: enr.calendarName,
        ...(days === null ? { warning: 'SchoolDaysUnavailable' as const } : {}),
        terms: trimmedTerms,
      });
    }

    return viewResponse((rawArgs as { view?: string }).view, result);
  });
}
