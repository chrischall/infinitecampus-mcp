import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };

let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
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

function defaultImpl(path: string) {
  if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
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
});
