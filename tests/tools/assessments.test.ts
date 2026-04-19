import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAssessmentTools } from '../../src/tools/assessments.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>, features: Record<string, boolean> = { assessment: true }) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  vi.spyOn(client, 'getFeatures').mockResolvedValue(features);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAssessmentTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

const STUDENT = {
  personID: 481,
  firstName: 'Jordan',
  lastName: 'Hall',
  enrollments: [
    { enrollmentID: 12398, calendarID: 50, structureID: 21, calendarName: '25-26 Scholars Academy 3-8' },
  ],
};

const STUDENT_MULTI = {
  personID: 482,
  firstName: 'Alex',
  lastName: 'Hall',
  enrollments: [
    { enrollmentID: 1, calendarID: 100, structureID: 1, calendarName: 'Calendar A' },
    { enrollmentID: 2, calendarID: 200, structureID: 2, calendarName: 'Calendar B' },
  ],
};

describe('ic_list_assessments', () => {
  it('returns one entry per enrollment with the three test categories', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({
        personID: 481,
        assessmentHTML: '<html>ignored</html>',
        stateTests: [{ name: 'EOC Math', score: '85' }],
        nationalTests: [{ name: 'SAT', score: '1400' }],
        districtTests: { tests: [{ name: 'BM1' }], typeTests: [{ type: 'Benchmark' }] },
      });
      throw new Error('unexpected path: ' + path);
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      enrollmentID: 12398,
      calendarID: 50,
      calendarName: '25-26 Scholars Academy 3-8',
      stateTests: [{ name: 'EOC Math', score: '85' }],
      nationalTests: [{ name: 'SAT', score: '1400' }],
      districtTests: { tests: [{ name: 'BM1' }], typeTests: [{ type: 'Benchmark' }] },
    });
    // assessmentHTML is dropped
    expect(JSON.stringify(data)).not.toContain('assessmentHTML');
  });

  it('normalizes nulls to empty arrays', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({
        personID: 481,
        assessmentHTML: null,
        stateTests: [],
        nationalTests: null,
        districtTests: { tests: null, typeTests: null },
      });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].stateTests).toEqual([]);
    expect(data[0].nationalTests).toEqual([]);
    expect(data[0].districtTests).toEqual({ tests: [], typeTests: [] });
  });

  it('handles completely missing districtTests', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({ personID: 481 });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].districtTests).toEqual({ tests: [], typeTests: [] });
  });

  it('iterates multiple enrollments', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT_MULTI]);
      if (path.includes('calendarID=100')) return Promise.resolve({ stateTests: [{ n: 'A' }], nationalTests: [], districtTests: { tests: [], typeTests: [] } });
      if (path.includes('calendarID=200')) return Promise.resolve({ stateTests: [{ n: 'B' }], nationalTests: [], districtTests: { tests: [], typeTests: [] } });
      throw new Error('unexpected path: ' + path);
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '482' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].calendarID).toBe(100);
    expect(data[0].stateTests).toEqual([{ n: 'A' }]);
    expect(data[1].calendarID).toBe(200);
    expect(data[1].stateTests).toEqual([{ n: 'B' }]);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '99999' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('handles student with no enrollments (returns empty array)', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: [] }]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('handles student where enrollments field is missing entirely', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([{ ...STUDENT, enrollments: undefined }]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
  });

  it('returns FeatureDisabled when all enrollments 404', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      return Promise.reject(new Error('IC 404 Not Found for /x'));
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ warning: 'FeatureDisabled', feature: 'assessments', district: 'anoka', data: [] });
  });

  it('partial success: one enrollment 404, other returns data — returns the working one', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT_MULTI]);
      if (path.includes('calendarID=100')) return Promise.reject(new Error('IC 404 Not Found for /x'));
      if (path.includes('calendarID=200')) return Promise.resolve({ stateTests: [{ n: 'B' }], nationalTests: [], districtTests: { tests: [], typeTests: [] } });
      throw new Error('unexpected path: ' + path);
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '482' });
    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].calendarID).toBe(200);
  });

  it('rethrows non-404 errors', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      return Promise.reject(new Error('IC 500 Internal Server Error'));
    });
    await expect(handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' })).rejects.toThrow('IC 500');
  });

  it('short-circuits via displayOptions when assessment flag is false', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('assessments endpoint should not be called');
    }, { assessment: false });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'assessments', district: 'anoka',
    });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.some((u) => u.includes('/campus/resources/prism/portal/assessments'))).toBe(false);
  });

  it('arrayifies a single stateTest returned as a bare object (prism XML→JSON quirk)', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({
        stateTests: { name: 'EOC Math', score: '85' }, // bare object, not an array
        nationalTests: [],
        districtTests: { tests: [], typeTests: [] },
      });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].stateTests).toEqual([{ name: 'EOC Math', score: '85' }]);
  });

  it('returns empty array when nationalTests is missing entirely', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({
        stateTests: [{ n: 'A' }],
        // nationalTests omitted
        districtTests: { tests: [], typeTests: [] },
      });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].nationalTests).toEqual([]);
  });

  it('arrayifies districtTests.tests as a bare object while typeTests stays an array', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      if (path.includes('calendarID=50')) return Promise.resolve({
        stateTests: [],
        nationalTests: [],
        districtTests: {
          tests: { name: 'BM1' }, // bare object
          typeTests: [{ type: 'Benchmark' }], // array
        },
      });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_assessments')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].districtTests).toEqual({
      tests: [{ name: 'BM1' }],
      typeTests: [{ type: 'Benchmark' }],
    });
  });
});
