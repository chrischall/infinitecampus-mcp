import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerTeacherTools } from '../../src/tools/teachers.js';

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
  registerTeacherTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

const TEACHERS = [
  {
    sectionID: 101,
    courseName: 'Algebra 1',
    courseNumber: 'M101',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@school.org',
    phone: '555-1234',
    role: 'Teacher',
    _id: 'x', _model: 'contact', _hashCode: 1, mTime: 't', personID: 12345,
  },
  {
    sectionID: 102, courseName: 'English', firstName: 'John', lastName: 'Smith',
    email: 'john.smith@school.org',
  },
];

const COUNSELORS = [
  {
    firstName: 'Pat',
    lastName: 'Jones',
    email: 'pat.jones@school.org',
    title: 'Counselor',
    _id: 'y', _model: 'counselor', personID: 12345,
  },
];

describe('ic_list_teachers', () => {
  it('calls both endpoints in parallel with personID', async () => {
    const calls: string[] = [];
    const client = setup((path) => {
      calls.push(path);
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.resolve(TEACHERS);
      if (path.startsWith('/campus/resources/portal/studentCounselor/byUser')) return Promise.resolve(COUNSELORS);
      throw new Error('unexpected: ' + path);
    });
    await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    expect(calls).toHaveLength(2);
    expect(calls.some((p) => p.includes('section/contacts?personID=12345'))).toBe(true);
    expect(calls.some((p) => p.includes('studentCounselor/byUser?personID=12345'))).toBe(true);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it('returns combined response with trimmed fields', async () => {
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.resolve(TEACHERS);
      if (path.startsWith('/campus/resources/portal/studentCounselor/byUser')) return Promise.resolve(COUNSELORS);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('counselors');
    expect(data).toHaveProperty('teachers');
    expect(data.teachers).toHaveLength(2);
    expect(data.counselors).toHaveLength(1);

    const jane = data.teachers[0];
    expect(jane).toMatchObject({
      sectionID: 101, courseName: 'Algebra 1', firstName: 'Jane', lastName: 'Doe',
      email: 'jane.doe@school.org',
    });
    expect(jane).not.toHaveProperty('_id');
    expect(jane).not.toHaveProperty('_model');
    expect(jane).not.toHaveProperty('personID');

    expect(data.counselors[0]).toMatchObject({
      firstName: 'Pat', lastName: 'Jones', email: 'pat.jones@school.org', title: 'Counselor',
    });
    expect(data.counselors[0]).not.toHaveProperty('_id');
    expect(data.counselors[0]).not.toHaveProperty('personID');
  });

  it('returns empty arrays when both endpoints 404', async () => {
    setup(() => Promise.reject(new Error('IC 404 Not Found')));
    const result = await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ counselors: [], teachers: [] });
  });

  it('handles null response from either endpoint', async () => {
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.resolve(null);
      if (path.startsWith('/campus/resources/portal/studentCounselor/byUser')) return Promise.resolve(null);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual({ counselors: [], teachers: [] });
  });

  it('handles counselor 404 while teachers succeed', async () => {
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.resolve(TEACHERS);
      return Promise.reject(new Error('IC 404 Not Found'));
    });
    const result = await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data.teachers).toHaveLength(2);
    expect(data.counselors).toEqual([]);
  });

  it('rethrows non-404 errors from teachers endpoint', async () => {
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.reject(new Error('IC 500 Internal Error'));
      return Promise.resolve([]);
    });
    await expect(handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow('IC 500');
  });

  it('rethrows non-404 errors from counselors endpoint', async () => {
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/studentCounselor/byUser')) return Promise.reject(new Error('IC 500 Internal Error'));
      return Promise.resolve([]);
    });
    await expect(handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow('IC 500');
  });

  it('drops undefined fields and preserves unknown fields via passthrough', async () => {
    const raw = [{
      sectionID: 1, firstName: 'X',
      customDistrictField: 'abc',
      undefinedField: undefined,
    }];
    setup((path) => {
      if (path.startsWith('/campus/resources/portal/section/contacts')) return Promise.resolve(raw);
      return Promise.resolve([]);
    });
    const result = await handlers.get('ic_list_teachers')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data.teachers[0]).toEqual({
      sectionID: 1, firstName: 'X', customDistrictField: 'abc',
    });
  });
});
