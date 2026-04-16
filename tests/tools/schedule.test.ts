import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerScheduleTools } from '../../src/tools/schedule.js';

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
  registerScheduleTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_get_schedule', () => {
  it('calls schedule endpoint with studentId', async () => {
    const raw = [{ period: 1, course: 'Math', room: '203' }];
    const client = setup(raw);
    const result = await handlers.get('ic_get_schedule')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('12345'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('passes date arg through when provided', async () => {
    const client = setup([]);
    await handlers.get('ic_get_schedule')!({ district: 'anoka', studentId: '12345', date: '2026-04-15' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('2026-04-15'));
  });

  it('passes termFilter when provided', async () => {
    const client = setup([]);
    await handlers.get('ic_get_schedule')!({ district: 'anoka', studentId: '12345', termFilter: 'T2' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('T2');
  });
});
