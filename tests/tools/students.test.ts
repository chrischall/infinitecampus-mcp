import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerStudentTools } from '../../src/tools/students.js';

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
  registerStudentTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_students', () => {
  it('calls the parent students endpoint for the given district', async () => {
    const raw = [{ personID: 12345, firstName: 'Alex', lastName: 'Doe', grade: '07' }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_students')!({ district: 'anoka' });
    expect(client.request).toHaveBeenCalledWith('anoka', expect.stringContaining('/students'));
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('rejects when district arg is missing', async () => {
    setup([]);
    await expect(handlers.get('ic_list_students')!({})).rejects.toThrow();
  });
});
