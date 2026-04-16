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
  it('defaults to inbox folder', async () => {
    const client = setup([]);
    await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('inbox');
  });

  it('passes folder, page, and size', async () => {
    const client = setup([]);
    await handlers.get('ic_list_messages')!({ district: 'anoka', folder: 'sent', page: 2, size: 25 });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('sent');
    expect(url).toContain('page=2');
    expect(url).toContain('size=25');
  });
});

describe('ic_get_message', () => {
  it('calls /messages/<id>', async () => {
    const client = setup({ id: 'abc', subject: 'Hi' });
    await handlers.get('ic_get_message')!({ district: 'anoka', messageId: 'abc' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('/abc'));
  });
});

describe('ic_list_message_recipients', () => {
  it('returns teachers + counselors for a student', async () => {
    const raw = [{ recipientId: 'T1', name: 'Mrs. Smith', role: 'teacher' }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_message_recipients')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('12345'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });
});
