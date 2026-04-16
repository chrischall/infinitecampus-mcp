import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerFeeTools } from '../../src/tools/fees.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerFeeTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_fees', () => {
  it('combines feeAssignments and totalSurplus into one response', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([{ id: 1, amount: '25.00', description: 'Lab fee' }]);
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(15);
      throw new Error('unexpected: ' + path);
    });
    const result = await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({
      totalSurplus: 15,
      feeAssignments: [{ id: 1, amount: '25.00', description: 'Lab fee' }],
    });
  });

  it('handles empty state (no fees, 0 surplus)', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([]);
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(0);
      throw new Error('unexpected: ' + path);
    });
    const result = await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ totalSurplus: 0, feeAssignments: [] });
  });

  it('passes personID as a query parameter', async () => {
    const client = setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([]);
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(0);
      throw new Error('unexpected');
    });
    await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const mock = client.request as ReturnType<typeof vi.fn>;
    const urls = mock.mock.calls.map((c) => c[1] as string);
    expect(urls.every((u) => u.includes('personID=481'))).toBe(true);
  });

  it('runs both requests in parallel', async () => {
    const client = setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([]);
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(0);
      throw new Error('unexpected');
    });
    await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('returns FeatureDisabled when BOTH endpoints 404', async () => {
    setup(() => Promise.reject(new Error('IC 404 Not Found for /x')));
    const result = await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({
      warning: 'FeatureDisabled',
      feature: 'fees',
      district: 'anoka',
      data: { totalSurplus: null, feeAssignments: [] },
    });
  });

  it('returns working endpoint with a note when only assignments 404', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.reject(new Error('IC 404 Not Found'));
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(42);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data.totalSurplus).toBe(42);
    expect(data.feeAssignments).toEqual([]);
    expect(data.notes).toBeDefined();
    expect(data.notes[0]).toContain('feeAssignments');
  });

  it('returns working endpoint with a note when only surplus 404', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([{ id: 1 }]);
      if (path.includes('/totalSurplus/-1')) return Promise.reject(new Error('IC 404 Not Found'));
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data.totalSurplus).toBeNull();
    expect(data.feeAssignments).toEqual([{ id: 1 }]);
    expect(data.notes).toBeDefined();
    expect(data.notes[0]).toContain('totalSurplus');
  });

  it('rethrows non-404 errors from feeAssignments', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.reject(new Error('IC 500 Internal Server Error'));
      if (path.includes('/totalSurplus/-1')) return Promise.resolve(0);
      throw new Error('unexpected');
    });
    await expect(handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' })).rejects.toThrow('IC 500');
  });

  it('rethrows non-404 errors from totalSurplus', async () => {
    setup((path) => {
      if (path.includes('/feeAssignments')) return Promise.resolve([]);
      if (path.includes('/totalSurplus/-1')) return Promise.reject(new Error('IC 500 Internal Server Error'));
      throw new Error('unexpected');
    });
    await expect(handlers.get('ic_list_fees')!({ district: 'anoka', studentId: '481' })).rejects.toThrow('IC 500');
  });
});
