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

/** One group per enrollment from portal/dayEvent/byEnrollment. */
interface RawDayEventGroup {
  events?: RawDayEvent[];
}

interface RawDayEvent {
  calendarID: number;
  date: string;
  name: string;
  /** False when the event takes the day out of instruction (holiday, workday, break). */
  instruction: boolean;
}

interface TrimmedDay {
  date: string;
  requiresAttendance: boolean;
  comments?: string;
}

interface DayOff {
  date: string;
  comments: string;
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
  /** The district's Campus version, alongside a warning — for bug reports. */
  campusVersion?: string;
  terms: TrimmedTerm[];
  /**
   * Labelled days out of instruction. Per enrollment, not per term: breaks
   * often fall BETWEEN terms (Q3 ends before spring break, Q4 starts after).
   */
  daysOff?: DayOff[];
}

/** The portal answered, but not with this resource: worth trying another route. */
function isRouteFailure(e: unknown): boolean {
  return e instanceof PortalUnreachableError || is404(e);
}

type DayRoute = 'instructionalDay' | 'day';

/**
 * Districts (per client) that last answered on calendar/day rather than
 * instructionalDay. Asking the broken route first on every call would cost one
 * guaranteed-failing request per enrollment. It is a preference, not a
 * verdict: if calendar/day stops answering, instructionalDay is tried again.
 */
const preferDayRoute = new WeakMap<ICClient, Set<string>>();

async function fetchDayRoute(
  client: ICClient,
  district: string,
  calendarID: number,
  route: DayRoute,
): Promise<RawInstructionalDay[]> {
  if (route === 'instructionalDay') {
    return toArray(await client.request<RawInstructionalDay | RawInstructionalDay[]>(
      district, `/campus/resources/calendar/instructionalDay?calendarID=${calendarID}`));
  }
  const all = toArray(await client.request<RawCalendarDay | RawCalendarDay[]>(
    district, `/campus/resources/calendar/day?calendarID=${calendarID}`));
  return all.filter((d) => d.isInstructionalDay);
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
  let preferred = preferDayRoute.get(client);
  if (!preferred) preferDayRoute.set(client, (preferred = new Set()));
  const routes: DayRoute[] = preferred.has(district) ? ['day', 'instructionalDay'] : ['instructionalDay', 'day'];
  for (const route of routes) {
    try {
      const days = await fetchDayRoute(client, district, calendarID, route);
      if (route === 'day') preferred.add(district);
      else preferred.delete(district);
      return days;
    } catch (e) {
      if (!isRouteFailure(e)) throw e;
    }
  }
  return null;
}

/**
 * Event labels by calendarID → date, from portal/dayEvent/byEnrollment. Neither
 * day route carries `comments` any more, so this is where "Holiday" or
 * "Teacher Work Day" lives now. Labels are a nicety: a route failure costs only
 * the labels (an empty map), but a session error still propagates.
 */
async function fetchDayEvents(
  client: ICClient,
  district: string,
  personID: string,
): Promise<Map<number, Map<string, RawDayEvent[]>>> {
  let groups: RawDayEventGroup[];
  try {
    groups = toArray(await client.request<RawDayEventGroup | RawDayEventGroup[]>(
      district, `/campus/resources/portal/dayEvent/byEnrollment?personID=${encodeURIComponent(personID)}`));
  } catch (e) {
    if (!isRouteFailure(e)) throw e;
    groups = [];
  }
  const byCalendar = new Map<number, Map<string, RawDayEvent[]>>();
  for (const ev of groups.flatMap((g) => toArray(g.events))) {
    let byDate = byCalendar.get(ev.calendarID);
    if (!byDate) byCalendar.set(ev.calendarID, (byDate = new Map()));
    byDate.set(ev.date, [...(byDate.get(ev.date) ?? []), ev]);
  }
  return byCalendar;
}

/** Distinct, non-empty labels joined the way IC's old `comments` read. */
function joinLabels(labels: Array<string | null | undefined>): string {
  return [...new Set(labels.filter((l): l is string => !!l))].join('; ');
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
      "List a student's school days (instructional calendar) grouped by term. Returns one entry per enrollment, with term boundaries (Q1-Q4 start/end dates) and the school days inside each term — a day carries comments when the calendar labels it (e.g. 'Early Release Day'). Each enrollment also lists its labelled daysOff (e.g. 'Holiday', 'Teacher Work Day', 'Spring Break'), including breaks that fall between terms. Use since/until to narrow the range. An enrollment whose day list the district won't serve comes back with warning 'SchoolDaysUnavailable' (plus campusVersion when known), its terms and days off, and no school days.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ ...argsSchema.shape, view: viewArg() }),
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    // 1. Get student to find their enrollment(s) → calendarID + structureID
    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const result: CalendarByEnrollment[] = [];
    const enrollments = student.enrollments ?? [];
    // One call covers every enrollment; skip it when there are none.
    const events = enrollments.length > 0
      ? await fetchDayEvents(client, args.district, args.studentId)
      : new Map<number, Map<string, RawDayEvent[]>>();

    // 2. For each enrollment, fetch terms + instructional days
    for (const enr of enrollments) {
      const [termsRaw, days] = await Promise.all([
        client.request<RawTerm | RawTerm[]>(args.district, `/campus/resources/term?structureID=${enr.structureID}`),
        fetchInstructionalDays(client, args.district, enr.calendarID),
      ]);
      const terms = toArray(termsRaw);

      // 3. Filter days by since/until range
      const inRange = (date: string) =>
        !(args.since && date < args.since) && !(args.until && date > args.until);
      const filteredDays = (days ?? []).filter((d) => inRange(d.date));
      const calendarEvents = events.get(enr.calendarID) ?? new Map<string, RawDayEvent[]>();
      // Labelled dates IC itself marks as out of instruction, oldest first.
      const daysOff: DayOff[] = [...calendarEvents.entries()]
        .filter(([date, evs]) => inRange(date) && evs.some((e) => e.instruction === false))
        .map(([date, evs]) => ({ date, comments: joinLabels(evs.map((e) => e.name)) }))
        .sort((a, b) => a.date.localeCompare(b.date));

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
              const comments = joinLabels([d.comments, ...(calendarEvents.get(d.date) ?? []).map((e) => e.name)]);
              if (comments) out.comments = comments;
              return out;
            }),
        }))
        // Drop terms entirely outside the since/until range. With no days to
        // go on, judge a term by whether its own dates overlap the range.
        .filter((t) => days === null
          ? !(args.since && t.endDate < args.since) && !(args.until && t.startDate > args.until)
          : t.days.length > 0 || (!args.since && !args.until));
      const campusVersion = days === null ? await client.campusVersion(args.district) : null;

      result.push({
        enrollmentID: enr.enrollmentID,
        calendarID: enr.calendarID,
        structureID: enr.structureID,
        calendarName: enr.calendarName,
        ...(days === null ? { warning: 'SchoolDaysUnavailable' as const } : {}),
        ...(campusVersion ? { campusVersion } : {}),
        terms: trimmedTerms,
        ...(daysOff.length > 0 ? { daysOff } : {}),
      });
    }

    return viewResponse((rawArgs as { view?: string }).view, result);
  });
}
