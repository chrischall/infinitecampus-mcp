import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAssignmentTools } from '../../src/tools/assignments.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };

let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerAssignmentTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_assignments', () => {
  const raw = [
    { assignmentName: 'HW1', courseName: 'Math',  sectionID: 1, dueDate: '2026-01-15T04:59:00.000Z', missing: false },
    { assignmentName: 'Lab', courseName: 'Sci',   sectionID: 2, dueDate: '2026-03-20T04:59:00.000Z', missing: true  },
    { assignmentName: 'Essay', courseName: 'Eng', sectionID: 3, dueDate: '2026-04-10T04:59:00.000Z', missing: false },
    { assignmentName: 'NoDate', courseName: 'Eng', sectionID: 3, missing: false },
  ];

  it('returns all assignments by default', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('calls the listView endpoint with personID', async () => {
    const client = setup([]);
    await handlers.get('ic_list_assignments')!({ district: 'anoka', studentId: '12345' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('/assignment/listView');
    expect(url).toContain('personID=12345');
  });

  it('passes sectionID server-side when courseId provided', async () => {
    const client = setup([]);
    await handlers.get('ic_list_assignments')!({ district: 'anoka', studentId: '12345', courseId: '40171' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('sectionID=40171');
  });

  it('does NOT pass startDate/endDate to the URL (endpoint ignores them)', async () => {
    const client = setup([]);
    await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', since: '2026-03-01', until: '2026-04-15',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).not.toContain('startDate');
    expect(url).not.toContain('endDate');
  });

  it('filters client-side by since (dueDate >= since)', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', since: '2026-03-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.map((a: { assignmentName: string }) => a.assignmentName)).toEqual(['Lab', 'Essay']);
  });

  it('filters client-side by until (dueDate <= until, inclusive on YYYY-MM-DD)', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', until: '2026-03-20',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.map((a: { assignmentName: string }) => a.assignmentName)).toEqual(['HW1', 'Lab']);
  });

  it('combines since, until, and missingOnly filters', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345',
      since: '2026-01-01', until: '2026-04-30', missingOnly: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].assignmentName).toBe('Lab');
  });

  it('missingOnly filter', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', missingOnly: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].assignmentName).toBe('Lab');
  });

  it('excludes assignments with no dueDate when filtering by date', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', since: '2020-01-01',
    });
    const data = JSON.parse(result.content[0].text);
    // The NoDate assignment is excluded because filter requires dueDate string
    expect(data.map((a: { assignmentName: string }) => a.assignmentName)).toEqual(['HW1', 'Lab', 'Essay']);
  });
});
