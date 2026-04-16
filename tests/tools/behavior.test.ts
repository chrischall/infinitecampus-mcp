import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerBehaviorTools } from '../../src/tools/behavior.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(impl: () => Promise<unknown>) {
  const client = new ICClient(accounts);
  vi.spyOn(client, 'request').mockImplementation(impl);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerBehaviorTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_behavior', () => {
  it('returns behavior events on success', async () => {
    setup(async () => [{ id: 1, type: 'minor', date: '2026-04-01' }]);
    const result = await handlers.get('ic_list_behavior')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 1, type: 'minor', date: '2026-04-01' }]);
  });

  it('returns FeatureDisabled warning on 404', async () => {
    setup(async () => { throw new Error('IC 404 Not Found for /x'); });
    const result = await handlers.get('ic_list_behavior')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ warning: 'FeatureDisabled', feature: 'behavior', district: 'anoka', data: [] });
  });

  it('rethrows non-404 errors', async () => {
    setup(async () => { throw new Error('IC 500 Internal Server Error'); });
    await expect(handlers.get('ic_list_behavior')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow();
  });
});
