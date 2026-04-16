import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAssignmentTools } from '../../src/tools/assignments.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];

let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
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
    { id: 1, courseName: 'Math', title: 'HW1', missing: false, scored: true, points: 10 },
    { id: 2, courseName: 'Sci', title: 'Lab', missing: true, scored: false, points: null },
  ];

  it('returns all assignments by default', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('filters to missingOnly when requested', async () => {
    setup(raw);
    const result = await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', missingOnly: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(2);
  });

  it('passes courseId, since, until through to the request URL', async () => {
    const client = setup([]);
    await handlers.get('ic_list_assignments')!({
      district: 'anoka', studentId: '12345', courseId: 'C1', since: '2026-03-01', until: '2026-04-15',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('C1');
    expect(url).toContain('2026-03-01');
    expect(url).toContain('2026-04-15');
  });
});
