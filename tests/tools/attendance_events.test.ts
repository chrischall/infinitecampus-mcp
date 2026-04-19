import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAttendanceEventsTools } from '../../src/tools/attendance_events.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>, features: Record<string, boolean> = { attendance: true }) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  vi.spyOn(client, 'getFeatures').mockResolvedValue(features);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAttendanceEventsTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

const STUDENT = {
  personID: 12345,
  enrollments: [
    { enrollmentID: 12398, calendarID: 5592, structureID: 3917, calendarName: '25-26 Scholars Academy 3-8' },
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

const EVENTS_RESPONSE = {
  calendarID: 5592,
  calendarName: '25-26 Scholars Academy 3-8',
  enrollmentID: 12398,
  structureID: 3917,
  schoolName: 'Westside Academy',
  crossSiteEnrollment: false,
  endDate: '2026-06-10',
  personID: 12345, // should be dropped
  firstName: 'Test', // should be dropped
  lastName: 'Student', // should be dropped
  _model: 'attendance', // should be dropped
  events: [
    {
      attendanceID: 9154, date: '2025-11-13', localDate: '2025-11-13',
      code: '1L', description: 'Excused Tardy', excuse: 'E', excuseType: 'Tardy',
      comments: 'Doctor appointment', termID: 27, status: 'T', periodID: 296,
      modifiedDate: '2025-11-13T10:00:00', wholeDayAbsence: false,
      _id: 'x', _model: 'evt', _hashCode: 123, mTime: 't', action: 'none',
      sectionPlacements: [FULL_SP], pairID: null, pairedEvent: null, crossSiteTransfer: false,
      isKentucky: false,
    },
    {
      attendanceID: 9155, date: '2026-02-10', localDate: '2026-02-10',
      code: '1A', description: 'Absent', excuse: 'U', excuseType: 'Absent',
      termID: 28, status: 'A', periodID: 296, wholeDayAbsence: true,
    },
    {
      attendanceID: 9156, date: '2026-03-15', localDate: '2026-03-15',
      code: '1L', description: 'Excused Tardy', excuse: 'E', excuseType: 'Tardy',
      termID: 28, status: 'T', periodID: 296, wholeDayAbsence: false,
    },
  ],
};

describe('ic_list_attendance_events', () => {
  it('auto-resolves enrollmentID and calls events endpoint with both query params', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('Unexpected path: ' + path);
    });
    await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(calls[1]).toContain('enrollmentID=12398');
    expect(calls[1]).toContain('personID=12345');
  });

  it('trims internal/private fields and returns useful subset', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      enrollmentID: 12398,
      calendarName: '25-26 Scholars Academy 3-8',
      schoolName: 'Westside Academy',
    });
    expect(data[0]).not.toHaveProperty('personID');
    expect(data[0]).not.toHaveProperty('firstName');
    expect(data[0]).not.toHaveProperty('_model');

    expect(data[0].events).toHaveLength(3);
    const first = data[0].events[0];
    expect(first).toEqual({
      attendanceID: 9154, date: '2025-11-13', localDate: '2025-11-13',
      code: '1L', description: 'Excused Tardy', excuse: 'E', excuseType: 'Tardy',
      comments: 'Doctor appointment', termID: 27, status: 'T', periodID: 296,
      modifiedDate: '2025-11-13T10:00:00', wholeDayAbsence: false,
      sectionPlacements: [TRIMMED_SP],
    });
    expect(first).not.toHaveProperty('_id');
    expect(first).not.toHaveProperty('pairID');
    // sectionPlacements is kept but trimmed — original noisy fields gone
    expect(first.sectionPlacements[0]).not.toHaveProperty('sectionID');
    expect(first.sectionPlacements[0]).not.toHaveProperty('courseName');
    // Events without sectionPlacements still drop the field entirely
    expect(data[0].events[1]).not.toHaveProperty('sectionPlacements');
  });

  it('handles array-wrapped response', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve([EVENTS_RESPONSE]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].events).toHaveLength(3);
  });

  it('filters events by since/until (localDate)', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01', until: '2026-02-28',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([9155]);
  });

  it('only since provided filters from that date forward', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', since: '2026-03-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([9156]);
  });

  it('only until provided filters up to that date', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', until: '2025-12-31',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([9154]);
  });

  it('excusedOnly filters to excuse=E events', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(EVENTS_RESPONSE);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', excusedOnly: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([9154, 9156]);
  });

  it('omits undefined periodName/startTime/endTime fields in trimmed sectionPlacements', async () => {
    const sparse = {
      ...EVENTS_RESPONSE,
      events: [
        {
          attendanceID: 500, localDate: '2026-04-01', code: 'A',
          sectionPlacements: [{ sectionID: 1, courseName: 'X' }], // no period fields
        },
        {
          attendanceID: 501, localDate: '2026-04-02', code: 'A',
          sectionPlacements: [{ periodName: 'P1' }], // only periodName
        },
      ],
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(sparse);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events[0].sectionPlacements).toEqual([{}]);
    expect(data[0].events[1].sectionPlacements).toEqual([{ periodName: 'P1' }]);
  });

  it('filters out events missing localDate when since/until are set', async () => {
    const resp = {
      ...EVENTS_RESPONSE,
      events: [
        { attendanceID: 1 }, // missing localDate
        { attendanceID: 2, localDate: '2026-03-15' },
      ],
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(resp);
      throw new Error('unexpected');
    });
    const withSince = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01',
    });
    expect(JSON.parse(withSince.content[0].text)[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([2]);

    const withUntil = await handlers.get('ic_list_attendance_events')!({
      district: 'anoka', studentId: '12345', until: '2026-12-31',
    });
    expect(JSON.parse(withUntil.content[0].text)[0].events.map((e: { attendanceID: number }) => e.attendanceID)).toEqual([2]);
  });

  it('handles response with no events field', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve({ enrollmentID: 12398 });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].events).toEqual([]);
  });

  it('queries all enrollments when student has multiple', async () => {
    const multi = {
      ...STUDENT,
      enrollments: [
        { enrollmentID: 12398, calendarID: 5592, structureID: 3917, calendarName: 'A' },
        { enrollmentID: 12399, calendarID: 5593, structureID: 3918, calendarName: 'B' },
      ],
    };
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([multi]);
      if (path.includes('enrollmentID=12398')) return Promise.resolve({ ...EVENTS_RESPONSE, enrollmentID: 12398 });
      if (path.includes('enrollmentID=12399')) return Promise.resolve({ ...EVENTS_RESPONSE, enrollmentID: 12399, events: [] });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].enrollmentID).toBe(12398);
    expect(data[1].enrollmentID).toBe(12399);
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '99999' });
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('handles student with no enrollments', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: [] }]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it('handles student with undefined enrollments field', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: undefined }]);
      throw new Error('should not be called');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it('returns FeatureDisabled on 404 from events endpoint', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'getFeatures').mockResolvedValue({ attendance: true });
    vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
      if (path === '/campus/api/portal/students') return [STUDENT];
      throw new Error('IC 404 Not Found for /x');
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerAttendanceEventsTools(server, client);
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'attendance_events', district: 'anoka', data: [],
    });
  });

  it('rethrows non-404 errors', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'getFeatures').mockResolvedValue({ attendance: true });
    vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
      if (path === '/campus/api/portal/students') return [STUDENT];
      throw new Error('IC 500');
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerAttendanceEventsTools(server, client);
    await expect(handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow();
  });

  it('short-circuits via displayOptions when attendance flag is false', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('events endpoint should not be called');
    }, { attendance: false });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'attendance_events', district: 'anoka',
    });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.some((u) => u.startsWith('/campus/resources/portal/attendance/events'))).toBe(false);
  });

  it('arrayifies bare-object events and sectionPlacements (prism XML→JSON quirk)', async () => {
    const bare = {
      calendarID: 5592,
      enrollmentID: 12398,
      events: {
        attendanceID: 9154, localDate: '2025-11-13', code: '1L', excuse: 'E',
        sectionPlacements: FULL_SP, // bare object, not array
      },
    };
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.startsWith('/campus/resources/portal/attendance/events')) return Promise.resolve(bare);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_attendance_events')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].events).toHaveLength(1);
    expect(data[0].events[0].sectionPlacements).toEqual([TRIMMED_SP]);
  });
});
