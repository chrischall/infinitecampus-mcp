import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { ICClient, PortalUnreachableError, SessionExpiredError } from '../../src/client.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };

let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  vi.spyOn(client, 'campusVersion').mockResolvedValue('2635.16');
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerCalendarTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

const STUDENT = {
  personID: 12345,
  firstName: 'Alex',
  lastName: 'Hall',
  enrollments: [
    { enrollmentID: 426960, calendarID: 5592, structureID: 3917, calendarName: '25-26 Springfield HS' },
  ],
};

const TERMS = [
  { termID: 854, termName: 'Q1', startDate: '2025-08-25', endDate: '2025-10-31', structureID: 3917, seq: 1 },
  { termID: 855, termName: 'Q2', startDate: '2025-11-03', endDate: '2026-01-21', structureID: 3917, seq: 2 },
  { termID: 856, termName: 'Q3', startDate: '2026-01-22', endDate: '2026-04-02', structureID: 3917, seq: 3 },
  { termID: 857, termName: 'Q4', startDate: '2026-04-13', endDate: '2026-06-10', structureID: 3917, seq: 4 },
  // extra term from a different structure (filtered out)
  { termID: 999, termName: 'OTHER', startDate: '2025-08-25', endDate: '2026-06-10', structureID: 9999, seq: 1 },
];

const DAYS = [
  { date: '2025-08-25', requiresAttendance: true, comments: '1st Day of School' },
  { date: '2025-10-15', requiresAttendance: true, comments: null },
  { date: '2025-12-20', requiresAttendance: false, comments: 'Winter Break starts' },
  { date: '2026-03-15', requiresAttendance: true, comments: null },
  { date: '2026-05-01', requiresAttendance: true, comments: null },
];

// dayEvent/byEnrollment: one group per enrollment, labels for dates on the
// calendar. Most land on days OFF (instruction: false) — the instructional day
// list no longer carries comments at all, so these are the only labels.
const DAY_EVENTS = [
  {
    crossSiteEnrollment: false, structureID: 3917, displayName: '25-26 Springfield HS',
    events: [
      { calendarID: 5592, date: '2026-03-15', name: 'Early Release Day', code: 'ER', instruction: true },
      { calendarID: 5592, date: '2025-11-27', name: 'Holiday', code: 'HO', instruction: false },
      { calendarID: 5592, date: '2025-11-27', name: 'Thanksgiving', code: 'TG', instruction: false },
      { calendarID: 5592, date: '2026-04-06', name: 'Spring Break', code: 'SB', instruction: false },
      // another calendar's event is not this enrollment's
      { calendarID: 9999, date: '2025-11-28', name: 'Other calendar', code: 'X', instruction: false },
    ],
  },
];
const DAY_EVENT_PATH = '/campus/resources/portal/dayEvent/byEnrollment?personID=12345';

function defaultImpl(path: string) {
  if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
  if (path === DAY_EVENT_PATH) return Promise.resolve(DAY_EVENTS);
  if (path.includes('/resources/term?structureID=3917')) return Promise.resolve(TERMS);
  if (path.includes('/resources/calendar/instructionalDay?calendarID=5592')) return Promise.resolve(DAYS);
  throw new Error('Unexpected path: ' + path);
}

describe('ic_list_school_days', () => {
  it('returns grades-shaped response: enrollment → terms → days with comments', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      enrollmentID: 426960,
      calendarID: 5592,
      structureID: 3917,
      calendarName: '25-26 Springfield HS',
    });
    expect(data[0].terms).toHaveLength(4);
    expect(data[0].terms[0]).toMatchObject({ termID: 854, termName: 'Q1', startDate: '2025-08-25' });
    expect(data[0].terms[0].days[0]).toEqual({ date: '2025-08-25', requiresAttendance: true, comments: '1st Day of School' });
  });

  it('omits comments field when day has no comment', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    const q1Days = data[0].terms[0].days;
    const oct15 = q1Days.find((d: { date: string }) => d.date === '2025-10-15');
    expect(oct15).toEqual({ date: '2025-10-15', requiresAttendance: true });
    expect('comments' in oct15).toBe(false);
  });

  it('filters terms by structureID (ignores terms from other structures)', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    const termNames = data[0].terms.map((t: { termName: string }) => t.termName);
    expect(termNames).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(termNames).not.toContain('OTHER');
  });

  it('filters days by since/until and drops empty terms', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({
      district: 'anoka', studentId: '12345', since: '2026-02-01', until: '2026-05-31',
    });
    const data = JSON.parse(result.content[0].text);
    const terms = data[0].terms;
    // Q1 (empty), Q2 (empty) dropped; Q3 has Mar 15, Q4 has May 1
    expect(terms.map((t: { termName: string }) => t.termName)).toEqual(['Q3', 'Q4']);
    expect(terms[0].days.map((d: { date: string }) => d.date)).toEqual(['2026-03-15']);
    expect(terms[1].days.map((d: { date: string }) => d.date)).toEqual(['2026-05-01']);
  });

  it('only since provided filters from that date forward', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01',
    });
    const data = JSON.parse(result.content[0].text);
    const allDates = data[0].terms.flatMap((t: { days: Array<{ date: string }> }) => t.days.map((d) => d.date));
    expect(allDates).toEqual(['2026-03-15', '2026-05-01']);
  });

  it('only until provided filters up to that date', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({
      district: 'anoka', studentId: '12345', until: '2025-11-01',
    });
    const data = JSON.parse(result.content[0].text);
    const allDates = data[0].terms.flatMap((t: { days: Array<{ date: string }> }) => t.days.map((d) => d.date));
    expect(allDates).toEqual(['2025-08-25', '2025-10-15']);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    setup(defaultImpl);
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '99999' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('handles student with no enrollments', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: [] }]);
      return Promise.reject(new Error('should not be called'));
    });
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('handles student where enrollments field is missing entirely', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: undefined }]);
      return Promise.reject(new Error('should not be called'));
    });
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('keeps empty terms when no date filter is applied', async () => {
    // A term with no days in it should still be present when no range is specified
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('/resources/term?structureID=3917')) return Promise.resolve(TERMS);
      if (path === DAY_EVENT_PATH) return Promise.resolve([]);
      if (path.includes('/resources/calendar/instructionalDay?calendarID=5592')) {
        // days only in Q1
        return Promise.resolve([{ date: '2025-08-25', requiresAttendance: true, comments: null }]);
      }
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    // Without since/until, keep all 4 terms (Q2, Q3, Q4 have empty days arrays)
    expect(data[0].terms.map((t: { termName: string }) => t.termName)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(data[0].terms[0].days).toHaveLength(1);
    expect(data[0].terms[1].days).toHaveLength(0);
  });

  // Issue #253: some districts now 500 on calendar/instructionalDay — Campus
  // routes it as calendar/{calendarID} and reads "instructionalDay" as the ID.
  describe('instructionalDay fallback (#253)', () => {
    const http500 = () => Promise.reject(new PortalUnreachableError('anoka', 500));
    const http404 = () => Promise.reject(new Error('IC 404 Not Found for /campus/resources/calendar/day'));
    // calendar/day lists every calendar day; only isInstructionalDay ones count.
    const ALL_DAYS = [
      { date: '2025-08-20', isInstructionalDay: false, requiresAttendance: false, isSchoolDay: true },
      { date: '2025-08-25', isInstructionalDay: true, requiresAttendance: true, isSchoolDay: true },
      { date: '2025-10-15', isInstructionalDay: true, requiresAttendance: true, isSchoolDay: true },
      { date: '2025-11-27', isInstructionalDay: false, requiresAttendance: false, isSchoolDay: false },
      { date: '2026-03-15', isInstructionalDay: true, requiresAttendance: false, isSchoolDay: true },
    ];

    function impl(instructional: () => Promise<unknown>, day: () => Promise<unknown>) {
      return (path: string) => {
        if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
        if (path === DAY_EVENT_PATH) return Promise.resolve([]);
        if (path.includes('/resources/term?structureID=3917')) return Promise.resolve(TERMS);
        if (path === '/campus/resources/calendar/instructionalDay?calendarID=5592') return instructional();
        if (path === '/campus/resources/calendar/day?calendarID=5592') return day();
        throw new Error('Unexpected path: ' + path);
      };
    }

    async function run(i: () => Promise<unknown>, d: () => Promise<unknown>, args: Record<string, unknown> = {}) {
      setup(impl(i, d));
      const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345', ...args });
      return JSON.parse(result.content[0].text);
    }

    it('falls back to calendar/day (instructional days only) when instructionalDay 500s', async () => {
      const data = await run(http500, () => Promise.resolve(ALL_DAYS));
      expect(data[0].warning).toBeUndefined();
      const days = data[0].terms.flatMap((t: { days: unknown[] }) => t.days);
      expect(days).toEqual([
        { date: '2025-08-25', requiresAttendance: true },
        { date: '2025-10-15', requiresAttendance: true },
        { date: '2026-03-15', requiresAttendance: false },
      ]);
    });

    it('falls back to calendar/day when instructionalDay 404s', async () => {
      const data = await run(http404, () => Promise.resolve(ALL_DAYS));
      expect(data[0].terms[0].days.map((d: { date: string }) => d.date)).toEqual(['2025-08-25', '2025-10-15']);
    });

    it('returns terms with a SchoolDaysUnavailable warning when both day endpoints fail', async () => {
      const data = await run(http500, http404);
      expect(data[0]).toMatchObject({ enrollmentID: 426960, warning: 'SchoolDaysUnavailable', campusVersion: '2635.16' });
      expect(data[0].terms.map((t: { termName: string }) => t.termName)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
      expect(data[0].terms.every((t: { days: unknown[] }) => t.days.length === 0)).toBe(true);
    });

    it('when days are unavailable, since/until keeps the terms that overlap the range', async () => {
      const data = await run(http500, http500, { since: '2026-02-01', until: '2026-05-31' });
      expect(data[0].warning).toBe('SchoolDaysUnavailable');
      expect(data[0].terms.map((t: { termName: string }) => t.termName)).toEqual(['Q3', 'Q4']);
    });

    it('does not mask a session error on instructionalDay as a fallback', async () => {
      setup(impl(() => Promise.reject(new SessionExpiredError('anoka')), () => Promise.resolve(ALL_DAYS)));
      await expect(handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' }))
        .rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('does not mask a session error on the calendar/day fallback', async () => {
      setup(impl(http500, () => Promise.reject(new SessionExpiredError('anoka'))));
      await expect(handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' }))
        .rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('omits campusVersion from the warning when the version cannot be read', async () => {
      const client = setup(impl(http500, http500));
      vi.mocked(client.campusVersion).mockResolvedValue(null);
      const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
      const data = JSON.parse(result.content[0].text);
      expect(data[0].warning).toBe('SchoolDaysUnavailable');
      expect('campusVersion' in data[0]).toBe(false);
    });

    // Once a district has answered on calendar/day, asking instructionalDay
    // first on every call is one guaranteed-failing request per enrollment.
    it('remembers the working route: a later call goes straight to calendar/day', async () => {
      const client = setup(impl(http500, () => Promise.resolve(ALL_DAYS)));
      const call = () => handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
      await call();
      const request = vi.mocked(client.request);
      request.mockClear();
      await call();
      const paths = request.mock.calls.map((c) => c[1]);
      expect(paths).toContain('/campus/resources/calendar/day?calendarID=5592');
      expect(paths).not.toContain('/campus/resources/calendar/instructionalDay?calendarID=5592');
    });

    it('falls back to instructionalDay again when the remembered route stops working', async () => {
      let dayWorks = true;
      const client = setup(impl(
        () => (dayWorks ? http500() : Promise.resolve(DAYS)),
        () => (dayWorks ? Promise.resolve(ALL_DAYS) : http500()),
      ));
      const call = async () => JSON.parse((await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' })).content[0].text);
      await call();
      dayWorks = false;
      const data = await call();
      expect(data[0].warning).toBeUndefined();
      expect(data[0].terms[0].days[0].date).toBe('2025-08-25');
      // ...and having recovered on instructionalDay, the next call starts there.
      vi.mocked(client.request).mockClear();
      await call();
      const paths = vi.mocked(client.request).mock.calls.map((c) => c[1]);
      expect(paths).not.toContain('/campus/resources/calendar/day?calendarID=5592');
    });

    it('does not remember a route when neither answers', async () => {
      const client = setup(impl(http500, http500));
      const call = () => handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
      await call();
      vi.mocked(client.request).mockClear();
      await call();
      const paths = vi.mocked(client.request).mock.calls.map((c) => c[1]);
      expect(paths.indexOf('/campus/resources/calendar/instructionalDay?calendarID=5592'))
        .toBeLessThan(paths.indexOf('/campus/resources/calendar/day?calendarID=5592'));
    });
  });

  // Since 2026-10 neither day route carries `comments`; the labels live in
  // portal/dayEvent/byEnrollment, mostly on days that are not instructional.
  describe('day labels from dayEvent', () => {
    async function run(args: Record<string, unknown> = {}, impl: (path: string) => Promise<unknown> = defaultImpl) {
      setup(impl);
      const result = await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345', ...args });
      return JSON.parse(result.content[0].text);
    }

    it('labels an instructional day from its event', async () => {
      const data = await run();
      const q3 = data[0].terms.find((t: { termName: string }) => t.termName === 'Q3');
      expect(q3.days).toEqual([{ date: '2026-03-15', requiresAttendance: true, comments: 'Early Release Day' }]);
    });

    it('keeps a comment the day list still carries', async () => {
      const data = await run();
      expect(data[0].terms[0].days[0]).toEqual({ date: '2025-08-25', requiresAttendance: true, comments: '1st Day of School' });
    });

    it('lists the labelled days off in date order, joining two events on one date', async () => {
      const data = await run();
      expect(data[0].daysOff).toEqual([
        { date: '2025-11-27', comments: 'Holiday; Thanksgiving' },
        // between Q3 (ends 04-02) and Q4 (starts 04-13): in no term, still listed
        { date: '2026-04-06', comments: 'Spring Break' },
      ]);
      // another calendar's event is not this enrollment's
      expect(JSON.stringify(data)).not.toContain('Other calendar');
    });

    it('since/until applies to days off', async () => {
      const data = await run({ since: '2026-04-01', until: '2026-04-30' });
      expect(data[0].daysOff).toEqual([{ date: '2026-04-06', comments: 'Spring Break' }]);
    });

    it('omits daysOff when none are labelled', async () => {
      const data = await run({ since: '2025-08-01', until: '2025-09-30' });
      expect('daysOff' in data[0]).toBe(false);
    });

    it('still lists days off when the day list is unavailable', async () => {
      const data = await run({}, (path) => {
        if (path.includes('/calendar/instructionalDay') || path.includes('/calendar/day?')) {
          return Promise.reject(new PortalUnreachableError('anoka', 500));
        }
        return defaultImpl(path);
      });
      expect(data[0].warning).toBe('SchoolDaysUnavailable');
      expect(data[0].daysOff.map((d: { date: string }) => d.date)).toEqual(['2025-11-27', '2026-04-06']);
    });

    it('asks for day events once per student, not once per enrollment', async () => {
      const twoEnrollments = { ...STUDENT, enrollments: [STUDENT.enrollments[0], { ...STUDENT.enrollments[0], enrollmentID: 2 }] };
      const client = setup((path) => (path === '/campus/api/portal/students' ? Promise.resolve([twoEnrollments]) : defaultImpl(path)));
      await handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' });
      const calls = vi.mocked(client.request).mock.calls.filter((c) => c[1] === DAY_EVENT_PATH);
      expect(calls).toHaveLength(1);
    });

    it('a dayEvent route failure costs only the labels', async () => {
      const data = await run({}, (path) => (path === DAY_EVENT_PATH
        ? Promise.reject(new Error('IC 404 Not Found for ' + path))
        : defaultImpl(path)));
      expect(data[0].warning).toBeUndefined();
      expect(data[0].terms[2].days).toEqual([{ date: '2026-03-15', requiresAttendance: true }]);
      expect(JSON.stringify(data)).not.toContain('daysOff');
    });

    it('tolerates an event group with no events list', async () => {
      const data = await run({}, (path) => (path === DAY_EVENT_PATH
        ? Promise.resolve({ crossSiteEnrollment: false, structureID: 3917 })
        : defaultImpl(path)));
      expect(data[0].terms[2].days).toEqual([{ date: '2026-03-15', requiresAttendance: true }]);
    });

    it('does not mask a session error on dayEvent', async () => {
      setup((path) => (path === DAY_EVENT_PATH ? Promise.reject(new SessionExpiredError('anoka')) : defaultImpl(path)));
      await expect(handlers.get('ic_list_school_days')!({ district: 'anoka', studentId: '12345' }))
        .rejects.toBeInstanceOf(SessionExpiredError);
    });
  });
});
