import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerAttendanceTools } from '../../src/tools/attendance.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerAttendanceTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_attendance', () => {
  it('calls attendance endpoint with studentId and date range', async () => {
    const client = setup([]);
    await handlers.get('ic_list_attendance')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01', until: '2026-04-15',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('12345');
    expect(url).toContain('2026-01-01');
    expect(url).toContain('2026-04-15');
  });

  it('works without optional date args', async () => {
    const client = setup([{ date: '2026-04-01', status: 'absent' }]);
    const result = await handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([{ date: '2026-04-01', status: 'absent' }]);
  });

  it('returns FeatureDisabled warning on 404', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockImplementation(async () => { throw new Error('IC 404 Not Found for /x'); });
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
    vi.spyOn(client, 'request').mockImplementation(async () => { throw new Error('IC 500'); });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerAttendanceTools(server, client);
    await expect(handlers.get('ic_list_attendance')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow();
  });
});
