import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerDocumentTools } from '../../src/tools/documents.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const accounts = [{ name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' }];
let handlers: Map<string, ToolHandler>;

function setup(client: ICClient) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerDocumentTools(server, client);
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_documents', () => {
  it('returns document metadata array', async () => {
    const client = new ICClient(accounts);
    vi.spyOn(client, 'request').mockResolvedValue([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
  });
});
