import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerMessageTools } from '../../src/tools/messages.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerMessageTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_messages', () => {
  it('calls prism notifications endpoint with default limit', async () => {
    const client = setup({ status: 'OK', data: { NotificationList: { Notification: [] } } });
    await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('notifications.Notification-retrieve');
    expect(url).toContain('limitCount=20');
  });

  it('passes custom limit', async () => {
    const client = setup({ status: 'OK', data: {} });
    await handlers.get('ic_list_messages')!({ district: 'anoka', limit: 50 });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('limitCount=50');
  });
});

describe('ic_get_message', () => {
  it('calls prism unviewed count endpoint', async () => {
    const client = setup({ status: 'OK', data: { RecentNotifications: { count: '5' } } });
    await handlers.get('ic_get_message')!({ district: 'anoka' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('NotificationUser-countUnviewed');
  });
});
