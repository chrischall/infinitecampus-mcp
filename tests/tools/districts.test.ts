import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerDistrictTools } from '../../src/tools/districts.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };

let handlers: Map<string, ToolHandler>;

function setup() {
  const client = new ICClient(account);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _config: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerDistrictTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_districts', () => {
  it('returns configured district (no creds)', async () => {
    setup();
    const result = await handlers.get('ic_list_districts')!({});
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([
      { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', linked: false },
    ]);
  });
});
