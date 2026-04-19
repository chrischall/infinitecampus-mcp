import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerFoodServiceTools } from '../../src/tools/foodservice.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

const STUDENT = {
  personID: 12345,
  enrollments: [{ enrollmentID: 1, calendarID: 2, structureID: 3917 }],
};

function setup(reqImpl: (path: string) => Promise<unknown>, features: Record<string, boolean> = { foodService: true }) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => reqImpl(path));
  vi.spyOn(client, 'getFeatures').mockResolvedValue(features);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerFoodServiceTools(server, client);
  return client;
}
afterEach(() => vi.restoreAllMocks());

describe('ic_list_food_service', () => {
  it('returns balance + transactions on success', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      return Promise.resolve({ balance: 12.5, transactions: [] });
    });
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual({ balance: 12.5, transactions: [] });
  });

  it('passes date range params when provided', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      return Promise.resolve({ balance: 0, transactions: [] });
    });
    await handlers.get('ic_list_food_service')!({
      district: 'anoka', studentId: '12345', since: '2026-01-01', until: '2026-04-15',
    });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    const fsCall = urls.find((u) => u.startsWith('/campus/resources/portal/foodService'))!;
    expect(fsCall).toContain('2026-01-01');
    expect(fsCall).toContain('2026-04-15');
  });

  it('returns FeatureDisabled warning on 404 backstop', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('IC 404 Not Found');
    });
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'foodService', district: 'anoka',
      data: { balance: null, transactions: [] },
    });
  });

  it('short-circuits via displayOptions when foodService flag is false', async () => {
    const client = setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('endpoint should not be called');
    }, { foodService: false });
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'foodService', district: 'anoka',
      data: { balance: null, transactions: [] },
    });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.some((u) => u.startsWith('/campus/resources/portal/foodService'))).toBe(false);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('should not hit endpoint');
    });
    const result = await handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '99999' });
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('rethrows non-404 errors', async () => {
    setup((path) => {
      if (path === '/campus/api/portal/students') return Promise.resolve([STUDENT]);
      throw new Error('IC 500');
    });
    await expect(handlers.get('ic_list_food_service')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow();
  });
});
