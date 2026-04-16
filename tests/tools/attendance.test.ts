import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAttendanceTools } from '../../src/tools/attendance.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAttendanceTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

const STUDENT = {
  personID: 12345,
  firstName: 'Test',
  lastName: 'Student',
  enrollments: [
    { enrollmentID: 99001, calendarID: 5592, structureID: 3917, calendarName: '25-26 HS' },
  ],
};

const FULL_SP = {
  sectionID: 368, termID: 27, periodID: 296, trialID: 50, structureID: 50,
  startDate: '2025-10-29', endDate: '2026-01-20', courseID: 169,
  sectionNumber: 61, crossSiteSection: false, courseNumber: '99329Y0',
  courseName: 'Homeroom: 6-8', attendance: true, isResponsive: false,
  periodName: 'HR', startTime: '08:05:00', endTime: '15:05:00',
};

const TRIMMED_SP = { periodName: 'HR', startTime: '08:05:00', endTime: '15:05:00' };

const ATTENDANCE = {
  enrollmentID: 99001,
  terms: [
    {
      termID: 1,
      termName: 'Q1',
      fullAbsentDays: 2,
      courses: [
        {
          courseName: 'Math',
          absentList: [
            { date: '2026-01-15', code: 'A', description: 'Absent', sectionPlacements: [FULL_SP] },
            { date: '2026-03-10', code: 'A', description: 'Absent', sectionPlacements: [FULL_SP] },
          ],
          tardyList: [{ date: '2026-02-20', code: 'T', description: 'Tardy', sectionPlacements: [FULL_SP] }],
          presentList: [],
          earlyReleaseList: [],
        },
      ],
    },
  ],
};

describe('ic_list_attendance', () => {
  it('auto-resolves enrollmentID and calls the path endpoint', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(ATTENDANCE);
      throw new Error('Unexpected path: ' + path);
    });
    await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(calls[0]).toBe('/campus/api/portal/students');
    expect(calls[1]).toContain('/campus/resources/portal/attendance/99001');
    expect(calls[1]).toContain('courseSummary=true');
    expect(calls[1]).toContain('personID=12345');
  });

  it('returns the enrollment response (sectionPlacements trimmed) without date filters', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(ATTENDANCE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].terms[0].courses[0].absentList).toHaveLength(2);
    expect(data[0].terms[0].courses[0].tardyList).toHaveLength(1);
    // sectionPlacements trimmed to { periodName, startTime, endTime } only
    expect(data[0].terms[0].courses[0].absentList[0].sectionPlacements).toEqual([TRIMMED_SP]);
    expect(data[0].terms[0].courses[0].tardyList[0].sectionPlacements).toEqual([TRIMMED_SP]);
  });

  it('handles array-wrapped response from endpoint', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve([ATTENDANCE]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].terms[0].courses[0].absentList).toHaveLength(2);
  });

  it('filters absent/tardy/present/earlyRelease lists by since/until', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(ATTENDANCE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-02-01', until: '2026-03-31',
    });
    const data = JSON.parse(result.content[0].text);
    const course = data[0].terms[0].courses[0];
    expect(course.absentList).toEqual([{ date: '2026-03-10', code: 'A', description: 'Absent', sectionPlacements: [TRIMMED_SP] }]);
    expect(course.tardyList).toEqual([{ date: '2026-02-20', code: 'T', description: 'Tardy', sectionPlacements: [TRIMMED_SP] }]);
  });

  it('only since provided filters from that date forward', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(ATTENDANCE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-02-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].terms[0].courses[0].absentList).toHaveLength(1);
  });

  it('only until provided filters up to that date', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(ATTENDANCE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', until: '2026-02-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].terms[0].courses[0].absentList).toEqual([
      { date: '2026-01-15', code: 'A', description: 'Absent', sectionPlacements: [TRIMMED_SP] },
    ]);
  });

  it('handles missing list fields in courses', async () => {
    const sparse = {
      enrollmentID: 99001,
      terms: [{ termID: 1, courses: [{ courseName: 'X' }] }],
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(sparse);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].terms[0].courses[0].courseName).toBe('X');
  });

  it('handles terms without courses and enrollment without terms', async () => {
    const sparse = { enrollmentID: 99001, terms: [{ termID: 1 }] };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(sparse);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].terms[0].courses).toEqual([]);
  });

  it('handles entry with no terms field during filtering', async () => {
    const sparse = { enrollmentID: 99001 };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(sparse);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].terms).toEqual([]);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '99999' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('handles student with no enrollments', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: [] }]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('handles student with undefined enrollments field', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: undefined }]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('omits undefined periodName/startTime/endTime fields in trimmed sectionPlacements', async () => {
    const sparseSp = {
      enrollmentID: 99001,
      terms: [{
        termID: 1,
        courses: [{
          courseName: 'Sparse',
          absentList: [
            { date: '2026-04-01', code: 'A', sectionPlacements: [{ sectionID: 1, courseName: 'X' }] }, // no period fields
            { date: '2026-04-02', code: 'A', sectionPlacements: [{ periodName: 'P1' }] }, // only periodName
          ],
        }],
      }],
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(sparseSp);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    const list = data[0].terms[0].courses[0].absentList;
    expect(list[0].sectionPlacements).toEqual([{}]); // all three fields absent → empty object
    expect(list[1].sectionPlacements).toEqual([{ periodName: 'P1' }]);
  });

  it('filters list entries with missing/non-string date fields (kept as-is)', async () => {
    const withWeirdDate = {
      enrollmentID: 99001,
      terms: [
        {
          termID: 1,
          courses: [
            {
              absentList: [
                { code: 'A', description: 'No date' }, // missing date
                { date: '2026-03-15', code: 'A' },
              ],
            },
          ],
        },
      ],
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/99001')) return Promise.resolve(withWeirdDate);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01', until: '2026-12-31',
    });
    const data = JSON.parse(result.content[0].text);
    // missing-date entry kept (treated as in-range)
    expect(data[0].terms[0].courses[0].absentList).toHaveLength(2);
  });

  it('returns FeatureDisabled warning on 404 from attendance endpoint', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
      if (path === '/campus/api/portal/students') return [STUDENT];
      throw new Error('IC 404 Not Found for /x');
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerAttendanceTools(server, client);
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ warning: 'FeatureDisabled', feature: 'attendance', district: 'anoka', data: [] });
  });

  it('rethrows non-404 errors', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
      if (path === '/campus/api/portal/students') return [STUDENT];
      throw new Error('IC 500');
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerAttendanceTools(server, client);
    await expect(handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow();
  });
});
