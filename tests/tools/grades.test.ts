import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerGradeTools } from '../../src/tools/grades.js';

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
  registerGradeTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe('ic_list_grades', () => {
  it('calls the grades endpoint', async () => {
    const raw = [{ courseName: 'Math', grade: 'A-', percent: 91 }];
    const client = setup(raw);
    const result = await handlers.get('ic_list_grades')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', '/campus/resources/portal/grades');
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('does not pass studentId or termId in URL (endpoint returns all grades)', async () => {
    const client = setup([]);
    await handlers.get('ic_list_grades')!({ district: 'anoka', studentId: '12345', termId: 'T3' });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toBe('/campus/resources/portal/grades');
  });
});
